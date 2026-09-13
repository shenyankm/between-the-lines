"""The refusal to boot, which is the only guard that cannot be tested in production.

`production_guards` is what stands between a misconfigured deployment and one that
serves traffic. Every branch here fails closed at import time, so a mistake is a
container that never starts rather than a running service that leaks a credential or
bills without a ceiling. That is worth more than any runtime check, and it is only
worth it if each branch is actually reached by a test.

Unit-marked: constructing Settings touches no database and no network.
"""

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
    "monthly_cost_cap_usd": 25.0,
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
        ({"monthly_cost_cap_usd": 0.0}, "MONTHLY_COST_CAP_USD"),
        ({"monthly_cost_cap_usd": -5.0}, "MONTHLY_COST_CAP_USD"),
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
    # dev login, an http origin and no cost cap. A guard that fired here would make
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
            monthly_cost_cap_usd=0.0,
        )
        assert settings.environment == environment


def test_the_cost_cap_default_is_disabled_and_that_is_not_safe_for_production():
    # 0 means "no ceiling", which is correct for mock mode where a turn costs
    # nothing and would otherwise block CI. The pairing of these two assertions is
    # the point: the permissive default is only acceptable because the guard above
    # refuses to let it reach production.
    assert Settings(_env_file=None, environment="test").monthly_cost_cap_usd == 0.0
    with pytest.raises(ValidationError, match="MONTHLY_COST_CAP_USD"):
        build(monthly_cost_cap_usd=0.0)


def test_oauth_ready_needs_every_endpoint_not_just_the_credentials():
    # A partial OAuth configuration is worse than none: authorize_redirect would
    # send a browser to an empty URL. All five are required, so all five are checked.
    partial = {
        "zhihu_client_id": "fixture-client",
        "zhihu_client_secret": "fixture-secret",
        "zhihu_authorize_url": "https://partner.example/authorize",
        "zhihu_token_url": "https://partner.example/token",
    }
    assert build(**partial).oauth_ready is False
    assert build(**partial, zhihu_userinfo_url="https://partner.example/userinfo").oauth_ready
