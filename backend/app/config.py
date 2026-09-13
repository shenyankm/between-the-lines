from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import model_validator
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
    agent_mode: Literal["deepseek", "mock"] = "deepseek"
    deepseek_api_key: str = ""
    deepseek_api_base: str = "https://api.deepseek.com"
    # Retries are mode-gated in agents.py: mock keeps 0 so CI timing is exact and
    # a fabricated 429 in the fixture cannot be silently absorbed, while real
    # traffic gets bounded backoff. This value only applies outside mock mode.
    deepseek_max_retries: int = 2
    story_v2_enabled: bool = True
    guest_enabled: bool = True
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
        if self.environment == "production":
            if self.dev_login_enabled or self.agent_mode == "mock":
                raise ValueError("Production forbids development login and mock agents")
            if len(self.session_secret) < 32 or self.session_secret.startswith("development"):
                raise ValueError("Production requires a unique SESSION_SECRET (32+ characters)")
            if not self.public_origin.startswith("https://") or not self.deepseek_api_key:
                raise ValueError("Production requires HTTPS and DEEPSEEK_API_KEY")
            # The key is sent to this base URL on every turn, so a downgrade here
            # is a credential leak rather than a misconfiguration.
            if not self.deepseek_api_base.startswith("https://"):
                raise ValueError("Production requires an HTTPS DEEPSEEK_API_BASE")
            # 0 means "no cap", which is right for mock mode where turns are free
            # and unacceptable where they are billed. Refuse to boot without one.
            if self.monthly_cost_cap_usd <= 0:
                raise ValueError("Production requires a positive MONTHLY_COST_CAP_USD")
            if not self.oauth_ready:
                raise ValueError("Production requires complete Zhihu OAuth configuration")
        return self

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
