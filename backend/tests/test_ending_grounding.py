import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.ending_grounding import current_ending_facts, validate_ending_prose
from app.jobs import JobRunner

pytestmark = pytest.mark.unit


def repair_payload():
    return {
        "outcome": {"id": "limited_repair", "title": "有限修复"},
        "confirmed_facts": {
            "work": {},
            "relationship": {key: {} for key in ("friendship", "harm", "remedy", "follow_up")},
        },
    }


def test_projection_replaces_pending_descriptions_without_changing_history():
    state = {
        "work": {"facts": {"rules_proposed": {"detail": "尚待执行"}, "rules_changed": {}}},
        "relationship": {
            "intention": "friendship",
            "facts": {
                "friendship_offer": {"detail": "孙淼尚未回应"},
                "friendship": {"detail": "双方愿意保留友谊"},
                "sun_cut": {"detail": "曾经决定只谈工作"},
                "sun_observe": {},
                "harm": {},
                "remedy": {},
            },
        },
    }
    before = copy.deepcopy(state)
    facts = current_ending_facts(state)
    assert state == before
    assert set(facts["relationship"]) == {"friendship", "harm", "remedy"}
    assert set(facts["work"]) == {"rules_changed"}
    state["relationship"]["facts"].pop("friendship")
    assert "friendship_offer" in current_ending_facts(state)["relationship"]


@pytest.mark.parametrize(
    "text",
    [
        "对话仍停留在你表达意愿的阶段，孙淼尚未回应。",
        "孙淼还没有承认具体伤害。",
        "她尚未完成实际补救。",
        "对方仍未尊重你的边界。",
    ],
)
def test_rejects_denials_of_confirmed_repair_milestones(text):
    with pytest.raises(ValueError, match="contradicts"):
        validate_ending_prose(text, repair_payload())


def test_does_not_infer_an_unrecorded_response_or_another_persons_response():
    payload = repair_payload()
    validate_ending_prose("双方愿意保留友谊，张工尚未回应其他问题。", payload)
    payload["confirmed_facts"]["relationship"] = {"friendship_offer": {}}
    validate_ending_prose("孙淼尚未回应，关系仍待决定。", payload)


def test_attendance_cannot_be_denied_in_generated_ending():
    payload = repair_payload()
    payload["confirmed_facts"]["work"] = {"farewell_attended": {}}
    with pytest.raises(ValueError, match="attendance"):
        validate_ending_prose("你已经错过了欢送会。", payload)
    validate_ending_prose("你参加了欢送会，但代替你决定的做法仍需要纠正。", payload)


def test_reflection_cannot_duplicate_the_only_available_event():
    runner = JobRunner(SimpleNamespace())
    payload = {"facts": [{"event_id": "recorded", "event_summary": "尚未破局"}]}
    node = {
        "event_id": "recorded",
        "alternative": "可以先核对材料。",
        "possible_cost": "需要时间。",
    }
    assert len(runner.validate("reflection", payload, {"nodes": [node]})["nodes"]) == 1
    with pytest.raises(ValueError, match="Duplicate event"):
        runner.validate("reflection", payload, {"nodes": [node, node]})
    with pytest.raises(KeyError):
        runner.validate("reflection", payload, {"nodes": [{**node, "event_id": "invented"}]})


@pytest.mark.parametrize("valid_retry", [True, False])
async def test_generation_retries_contradiction_once_within_existing_budget(
    monkeypatch, valid_retry
):
    bad = '{"text":"孙淼尚未回应。"}'
    good = '{"text":"孙淼已承认伤害并完成补救，后续协作也尊重了边界。"}'
    model = SimpleNamespace(
        ainvoke=AsyncMock(
            side_effect=[
                SimpleNamespace(
                    content=bad, usage_metadata={"input_tokens": 10, "output_tokens": 5}
                ),
                SimpleNamespace(
                    content=good if valid_retry else bad,
                    usage_metadata={"input_tokens": 10, "output_tokens": 5},
                ),
            ]
        ),
        root_async_client=SimpleNamespace(close=AsyncMock()),
        root_client=SimpleNamespace(close=Mock()),
    )
    monkeypatch.setattr("app.jobs.make_model", lambda _: model)
    runner = JobRunner(SimpleNamespace(settings=SimpleNamespace()))
    if valid_retry:
        result = await runner.generate("ending", repair_payload())
        assert "已承认伤害" in result["text"]
    else:
        with pytest.raises(ValueError, match="contradicts"):
            await runner.generate("ending", repair_payload())
    assert model.ainvoke.await_count == 2
    assert all(
        call.kwargs["response_format"] == {"type": "json_object"}
        for call in model.ainvoke.await_args_list
    )
    model.root_async_client.close.assert_awaited_once()
