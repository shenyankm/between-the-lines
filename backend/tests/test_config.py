"""Production configuration guards, independent of database and provider calls."""

import pytest
from pydantic import ValidationError

from app.config import Settings

pytestmark = pytest.mark.unit

# Deliberately fake, and long enough to clear the 32-character floor. Nothing in
# this module is a credential; a real one would be a secret committed to the repo.
SECRET = "fixture-not-a-real-secret-value-0000"

# A configuration that satisfies every guard. Each test breaks exactly one field,
# so a failure names the guard that stopped working rather than a pile of them.
PRODUCTION = {
    "environment": "production",
    "dev_login_enabled": False,
    "agent_mode": "deepseek",
    "session_secret": SECRET,
    "public_origin": "https://play.example",
    "deepseek_api_key": "fixture-key-not-a-real-credential",
    "deepseek_api_base": "https://api.deepseek.com",
    "zhihu_client_id": "fixture",
    "zhihu_client_secret": "fixture-secret",
    "zhihu_authorize_url": "https://auth.example/authorize",
    "zhihu_token_url": "https://auth.example/token",
    "zhihu_userinfo_url": "https://auth.example/me",
}


def build(**overrides: object) -> Settings:
    # `_env_file=None` so a developer's local .env cannot satisfy a guard this test
    # is trying to prove fails. The configuration under test is exactly PRODUCTION
    # plus the one override, on every machine and in CI alike.
    return Settings(_env_file=None, **{**PRODUCTION, **overrides})


def test_a_complete_production_configuration_boots():
    # The control. Without it every test below could pass because the constructor
    # rejects production outright, and the guards would look thorough while doing
    # nothing.
    assert build().environment == "production"


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"dev_login_enabled": True}, "development login"),
        ({"agent_mode": "mock"}, "mock agents"),
        ({"session_secret": "too-short"}, "SESSION_SECRET"),
        ({"session_secret": "development-only-change-before-production"}, "SESSION_SECRET"),
        ({"public_origin": "http://play.example"}, "HTTPS"),
        ({"deepseek_api_key": ""}, "DEEPSEEK_API_KEY"),
        ({"deepseek_api_base": "http://api.deepseek.com"}, "DEEPSEEK_API_BASE"),
    ],
)
def test_each_production_guard_refuses_to_boot(overrides, fragment):
    with pytest.raises(ValidationError) as failure:
        build(**overrides)
    # Asserting on the message, not just on rejection: a guard that fires for the
    # wrong reason still prevents booting, and would hide the field an operator
    # actually needs to fix.
    assert fragment in str(failure.value)


def test_the_placeholder_secret_is_rejected_even_at_32_characters():
    # The default clears the length floor, so length alone would let a deployment
    # boot with a secret that is published in the repository. The prefix check is
    # what catches that specific case.
    assert len("development-only-change-before-production") >= 32
    with pytest.raises(ValidationError, match="SESSION_SECRET"):
        build(session_secret="development-only-change-before-production")


def test_the_guards_do_not_fire_outside_production():
    # Development has to be able to run with the checked-in defaults: mock agents,
    # dev login, an http origin. A guard that fired here would make
    # `make api` impossible without a credential nobody has locally.
    for environment in ("development", "test"):
        settings = build(
            environment=environment,
            dev_login_enabled=True,
            agent_mode="mock",
            session_secret="development-only-change-before-production",
            public_origin="http://localhost:5173",
            deepseek_api_key="",
            deepseek_api_base="http://localhost:9999",
        )
        assert settings.environment == environment


def test_oauth_ready_needs_every_endpoint_not_just_the_credentials():
    # A partial OAuth configuration is worse than none: authorize_redirect would
    # send a browser to an empty URL. All five are required, so all five are checked.
    partial = {
        "zhihu_client_id": "fixture-client",
        "zhihu_client_secret": "fixture-secret",
        "zhihu_authorize_url": "https://partner.example/authorize",
        "zhihu_token_url": "https://partner.example/token",
    }
    assert Settings(_env_file=None, environment="test", **partial).oauth_ready is False
    with pytest.raises(ValidationError, match="OAuth"):
        build(**partial, zhihu_userinfo_url="")
    assert build(**partial, zhihu_userinfo_url="https://partner.example/userinfo").oauth_ready


def test_removed_environment_limits_are_ignored(monkeypatch):
    for name in (
        "DAILY_TURN_LIMIT",
        "GUEST_AI_LIMIT",
        "MONTHLY_COST_CAP_USD",
        "MAX_MODEL_CALLS",
        "MAX_TOOL_CALLS",
        "AI_INPUT_BYTE_LIMIT",
        "MUTATION_LIMIT_PER_MINUTE",
        "DEEPSEEK_INPUT_USD_PER_MILLION",
        "DEEPSEEK_OUTPUT_USD_PER_MILLION",
    ):
        monkeypatch.setenv(name, "0")
        assert name.lower() not in Settings.model_fields
    assert build().environment == "production"
