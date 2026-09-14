import math
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.agents import make_model, model_text
from app.budget import monthly_commitment, reservation, settle
from app.config import Settings

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_unpriced_previous_requests_cannot_bypass_a_later_cost_cap():
    db = AsyncMock()
    db.scalar.return_value = "unpriced-job"
    assert math.isinf(await monthly_commitment(db))


@pytest.mark.asyncio
async def test_unknown_price_is_kept_in_the_durable_ledger_without_failing_the_reply():
    ledger = SimpleNamespace()
    db = AsyncMock()
    db.get.return_value = ledger
    job = SimpleNamespace(id="test", reserved_usd=0)
    usage = {"input_tokens": 10, "output_tokens": 20}
    await settle(db, job, config(), usage, False)
    assert job.status == "completed"
    assert usage["cost_estimate_usd"] is None
    assert ledger.status == "unpriced"


def config(**overrides):
    return Settings(
        _env_file=None,
        **{
            "agent_mode": "openai",
            "openai_api_key": "fixture-not-a-secret",
            "openai_base_url": "https://gateway.example/v1",
            "openai_model": "gpt-6-astra",
            **overrides,
        },
    )


@pytest.mark.asyncio
async def test_gpt6_uses_responses_without_deepseek_request_options():
    model = make_model(config())
    try:
        assert model.use_responses_api is True
        assert model.model_name == "gpt-6-astra"
        assert model.reasoning == {"effort": "low"}
        assert model.extra_body is None
        assert model.temperature is None
        assert model.max_retries == 1
    finally:
        await model.root_async_client.close()
        model.root_client.close()


def test_readiness_and_costs_belong_to_selected_provider():
    settings = config(deepseek_api_key="")
    assert settings.model_ready
    assert settings.estimate_cost(100, 200) is None
    assert not config(openai_api_key="", deepseek_api_key="other-provider").model_ready
    with pytest.raises(ValueError, match="gateway token prices"):
        config(monthly_cost_cap_usd=1)
    priced = config(openai_input_usd_per_million=2, openai_output_usd_per_million=8)
    assert priced.estimate_cost(100, 200) == 0.0018
    assert reservation(priced, calls=1) == round(2 * (24000 * 2 + 1600 * 8) / 1_000_000, 8)


def test_response_blocks_extract_text_without_reasoning_or_tool_arguments():
    assert (
        model_text(
            [
                {"type": "reasoning", "text": "private analysis"},
                {"type": "text", "text": '{"text":'},
                {"type": "output_text", "text": '"saved facts"}'},
                {"type": "function_call", "text": "tool arguments"},
            ]
        )
        == '{"text":"saved facts"}'
    )
    assert model_text(None) == ""


@pytest.mark.parametrize(
    "overrides",
    [
        {"openai_api_key": ""},
        {"openai_base_url": "http://gateway.example/v1"},
    ],
)
def test_invalid_gateway_configuration_does_not_send_a_request(overrides):
    with pytest.raises((ValueError, RuntimeError)):
        make_model(config(**overrides))
