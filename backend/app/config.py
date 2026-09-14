from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_DIR.parent


class Settings(BaseSettings):
    # Resolved from __file__, not the CWD, so the same config loads regardless of
    # launch directory. Later entries win: backend/.env overrides the repo-root .env.
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _BACKEND_DIR / ".env"),
        extra="ignore",
    )
    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://btl:btl@localhost:54329/btl"
    checkpoint_url: str = "postgresql://btl:btl@localhost:54329/btl"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    # json for anything that ships to `docker compose logs` and a log pipeline;
    # text for a human running `make api` in a terminal.
    log_format: Literal["json", "text"] = "json"
    # Deliberate placeholder, not a credential: production_guards below refuses to
    # boot with ENVIRONMENT=production while this default is still in use.
    session_secret: str = "development-only-change-before-production"  # noqa: S105
    public_origin: str = "http://localhost:5173"
    dev_login_enabled: bool = True
    agent_mode: Literal["deepseek", "mock", "openai"] = "deepseek"
    openai_api_key: str = Field(default="", repr=False)
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-6-astra"
    openai_reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "low"
    openai_max_retries: int = Field(default=1, ge=0, le=3)
    openai_max_output_tokens: int = Field(default=1600, ge=128, le=8192)
    openai_input_usd_per_million: float | None = Field(default=None, ge=0)
    openai_output_usd_per_million: float | None = Field(default=None, ge=0)
    deepseek_api_key: str = ""
    deepseek_api_base: str = "https://api.deepseek.com"
    # Retries are mode-gated in agents.py: mock keeps 0 so CI timing is exact and
    # a fabricated 429 in the fixture cannot be silently absorbed, while real
    # traffic gets bounded backoff. This value only applies outside mock mode.
    deepseek_max_retries: int = 2
    story_v2_enabled: bool = True
    guest_enabled: bool = True
    guest_full_story_enabled: bool = False
    automatic_intents_enabled: bool = True
    discussions_enabled: bool = True
    guest_ai_limit: int = 8
    guest_days: int = 7
    trusted_proxy_networks: list[str] = []
    active_save_limit: int = 20
    mutation_limit_per_minute: int = 60
    ai_input_byte_limit: int = 24000
    daily_turn_limit: int = 100
    max_concurrent_turns: int = 30
    turn_timeout_seconds: int = 60
    # Billing kill switch. 0 disables it, which is correct for mock mode where
    # every turn costs nothing and wrong for production -- see production_guards.
    monthly_cost_cap_usd: float = 0.0
    max_model_calls: int = 4
    max_tool_calls: int = 6
    deepseek_input_usd_per_million: float = 0.30
    deepseek_output_usd_per_million: float = 1.20
    zhihu_client_id: str = ""
    zhihu_protocol: Literal["standard", "hackathon"] = "standard"
    zhihu_access_secret: str = ""
    zhihu_client_secret: str = ""
    zhihu_authorize_url: str = ""
    zhihu_token_url: str = ""
    zhihu_userinfo_url: str = ""
    zhihu_scope: str = ""
    zhihu_subject_field: str = "id"
    zhihu_name_field: str = "name"

    @model_validator(mode="after")
    def production_guards(self) -> Self:
        if self.agent_mode == "openai":
            if not self.openai_base_url.startswith("https://"):
                raise ValueError("OPENAI_BASE_URL must use HTTPS")
            if not self.openai_model.strip():
                raise ValueError("OPENAI_MODEL must not be empty")
            if self.openai_model.startswith("gpt-6") and self.openai_reasoning_effort == "none":
                raise ValueError("GPT6 does not support OPENAI_REASONING_EFFORT=none")
            if self.monthly_cost_cap_usd > 0 and not self.pricing_known:
                raise ValueError("OpenAI cost cap requires configured gateway token prices")
        if self.environment == "production":
            if self.guest_full_story_enabled:
                raise ValueError("Full guest story is only available in development")
            if self.dev_login_enabled or self.agent_mode == "mock":
                raise ValueError("Production forbids development login and mock agents")
            if len(self.session_secret) < 32 or self.session_secret.startswith("development"):
                raise ValueError("Production requires a unique SESSION_SECRET (32+ characters)")
            if not self.public_origin.startswith("https://") or not self.model_ready:
                key = "OPENAI_API_KEY" if self.agent_mode == "openai" else "DEEPSEEK_API_KEY"
                raise ValueError(f"Production requires HTTPS and {key}")
            # The key is sent to this base URL on every turn, so a downgrade here
            # is a credential leak rather than a misconfiguration.
            if self.agent_mode == "deepseek" and not self.deepseek_api_base.startswith("https://"):
                raise ValueError("Production requires an HTTPS DEEPSEEK_API_BASE")
            # 0 means "no cap", which is right for mock mode where turns are free
            # and unacceptable where they are billed. Refuse to boot without one.
            if self.monthly_cost_cap_usd <= 0:
                raise ValueError("Production requires a positive MONTHLY_COST_CAP_USD")
            if not self.oauth_ready:
                raise ValueError("Production requires complete Zhihu OAuth configuration")
        return self

    @property
    def model_ready(self) -> bool:
        return self.agent_mode == "mock" or bool(
            self.openai_api_key if self.agent_mode == "openai" else self.deepseek_api_key
        )

    @property
    def model_name(self) -> str:
        return self.openai_model if self.agent_mode == "openai" else "deepseek-flash"

    @property
    def model_base_url(self) -> str:
        return self.openai_base_url if self.agent_mode == "openai" else self.deepseek_api_base

    @property
    def model_retries(self) -> int:
        return self.openai_max_retries if self.agent_mode == "openai" else self.deepseek_max_retries

    @property
    def model_output_tokens(self) -> int:
        return self.openai_max_output_tokens if self.agent_mode == "openai" else 800

    @property
    def pricing_known(self) -> bool:
        return self.agent_mode != "openai" or (
            self.openai_input_usd_per_million is not None
            and self.openai_output_usd_per_million is not None
        )

    def estimate_cost(self, input_tokens: int, output_tokens: int) -> float | None:
        if self.agent_mode == "mock":
            return 0.0
        if not self.pricing_known:
            return None
        incoming, outgoing = (
            (self.openai_input_usd_per_million, self.openai_output_usd_per_million)
            if self.agent_mode == "openai"
            else (self.deepseek_input_usd_per_million, self.deepseek_output_usd_per_million)
        )
        return round(
            (input_tokens * (incoming or 0) + output_tokens * (outgoing or 0)) / 1_000_000, 8
        )

    @property
    def oauth_ready(self) -> bool:
        return (self.zhihu_protocol != "hackathon" or bool(self.zhihu_access_secret)) and all(
            (
                self.zhihu_client_id,
                self.zhihu_client_secret,
                self.zhihu_authorize_url,
                self.zhihu_token_url,
                self.zhihu_userinfo_url,
            )
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
