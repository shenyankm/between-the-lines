import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.artifact_quality import diverse_sources, role_context
from app.db import Event
from app.jobs import JobRunner

pytestmark = pytest.mark.unit


def sources():
    return [
        {
            "id": "a",
            "url": "https://www.zhihu.com/question/1/answer/1",
            "title": "直接沟通",
            "author": "甲",
            "summary": "可以直接表达边界，同时保留沟通记录。",
        },
        {
            "id": "b",
            "url": "https://www.zhihu.com/question/2/answer/2",
            "title": "流程协作",
            "author": "乙",
            "summary": "整理流程记录，向负责人说明影响并请求协调。",
        },
    ]


def card(strategy="direct", source="a"):
    return {
        "strategy": strategy,
        "view": "明确表达边界",
        "situation": "同事替你决定时",
        "expression": "请先问我的意愿，再决定是否把我加入名单。",
        "possible_cost": "可能需要解释。",
        "source_ids": [source],
        "source_quotes": {source: "直接表达边界"},
    }


def test_selection_deduplicates_urls_ids_and_body_before_balancing_questions():
    a, b = sources()
    related = {
        **a,
        "id": "c",
        "url": "https://www.zhihu.com/question/1/answer/3",
        "summary": "另一种表达方式",
    }
    duplicate = {**a, "id": "other", "url": a["url"] + "?tracking=1"}
    duplicate_text = {
        **b,
        "id": "text",
        "url": b["url"] + "/3",
        "summary": "可以直接表达边界， 同时保留沟通记录！",
    }
    rows = [a, related, duplicate, duplicate_text, b]
    original = copy.deepcopy(rows)
    assert [r["id"] for r in diverse_sources(rows)] == ["a", "b", "c"]
    assert rows == original


def test_two_strategies_keep_original_sources_and_internal_fields_private():
    runner = object.__new__(JobRunner)
    second = {
        **card("process", "b"),
        "view": "用流程协调",
        "expression": "我已整理退回记录，请负责人帮忙明确要求与时限。",
        "source_quotes": {"b": "整理流程记录"},
    }
    result = runner.validate("discussion", {"sources": sources()}, {"cards": [card(), second]})
    assert len(result["cards"]) == 2
    assert result["cards"][0]["view"].startswith("直接沟通")
    assert result["cards"][1]["sources"][0]["author"] == "乙"
    assert "strategy" not in result["cards"][0] and "source_quotes" not in result["cards"][0]
    assert (
        "仅支持一类"
        in runner.validate("discussion", {"sources": sources()}, {"cards": [card()]})["label"]
    )
    assert (
        "编辑建议" in runner.validate("discussion", {"sources": sources()}, {"cards": []})["label"]
    )


@pytest.mark.parametrize(
    "change,reason",
    [
        ({}, "duplicate_strategy"),
        ({"strategy": "process", "view": "另一个标题"}, "duplicate_expression"),
        (
            {
                "strategy": "process",
                "view": "协作流程",
                "expression": "请协助处理审批。",
                "source_quotes": {"a": "我保证领导一定支持"},
            },
            "unsupported_source_quote",
        ),
        (
            {
                "strategy": "process",
                "view": "协作流程",
                "expression": "请协助处理审批。",
                "source_quotes": {"b": "整理流程记录"},
            },
            "missing_source_support",
        ),
    ],
)
def test_discussion_rejects_duplicate_and_unsupported_content(change, reason):
    with pytest.raises(ValueError, match=reason):
        object.__new__(JobRunner).validate(
            "discussion", {"sources": sources()}, {"cards": [card(), {**card(), **change}]}
        )


def test_role_context_does_not_default_system_or_missing_speaker_to_player():
    assert (
        role_context(Event(data={"kind": "work", "act": 3, "action": "clarify"}))["actor"]
        == "unknown"
    )
    assert role_context(Event(data={"kind": "player"}))["actor"] == "unknown"
    context = role_context(
        Event(
            data={
                "kind": "player",
                "speaker": "system",
                "action": "clarify",
                "act": 3,
                "channel": "group",
                "npc": "sun",
            }
        )
    )
    assert context["actor"] == "player" and context["player_role"] == "rumor_subject"


@pytest.mark.parametrize(
    "actor,advice",
    [
        ("npc", "可以公开说明自己的安排。"),
        ("player", "可以在转述前先向当事人确认。"),
        ("player", "建议孙淼主动承认错误。"),
    ],
)
def test_reflection_rejects_other_actor_or_rumor_role_swap(actor, advice):
    payload = {
        "facts": [
            {"event_id": "e", "role_context": {"actor": "player", "player_role": "rumor_subject"}}
        ]
    }
    with pytest.raises(ValueError):
        object.__new__(JobRunner).validate(
            "reflection",
            payload,
            {
                "nodes": [
                    {
                        "event_id": "e",
                        "actor": actor,
                        "alternative": advice,
                        "possible_cost": "需要沟通时间。",
                    }
                ]
            },
        )
    result = object.__new__(JobRunner).validate(
        "reflection",
        payload,
        {
            "nodes": [
                {
                    "event_id": "e",
                    "actor": "player",
                    "alternative": "可以向转述者说明自己的真实安排，并请求在原群里更正。",
                    "possible_cost": "可能扩大关注。",
                }
            ]
        },
    )
    assert "actor" not in result["nodes"][0]


@pytest.mark.parametrize("kind", ["discussion", "reflection"])
async def test_quality_failures_stop_after_two_model_calls(monkeypatch, kind):
    import json

    from app import jobs

    payload = {
        "sources": sources(),
        "facts": [
            {"event_id": "e", "role_context": {"actor": "player", "player_role": "rumor_subject"}}
        ],
    }
    invalid = (
        {"cards": [card(), card()]}
        if kind == "discussion"
        else {
            "nodes": [
                {
                    "event_id": "e",
                    "actor": "player",
                    "alternative": "在转述前先向当事人确认。",
                    "possible_cost": "沟通成本",
                }
            ]
        }
    )
    model = SimpleNamespace(
        ainvoke=AsyncMock(
            return_value=SimpleNamespace(
                content=json.dumps(invalid, ensure_ascii=False),
                usage_metadata={"input_tokens": 10, "output_tokens": 5},
            )
        ),
        root_async_client=SimpleNamespace(close=AsyncMock()),
        root_client=SimpleNamespace(close=Mock()),
    )
    monkeypatch.setattr(jobs, "make_model", lambda _: model)
    runner = JobRunner(SimpleNamespace(settings=SimpleNamespace()))
    with pytest.raises(ValueError):
        await runner.generate(kind, payload)
    assert model.ainvoke.await_count == 2
    model.root_async_client.close.assert_awaited_once()


@pytest.mark.parametrize(
    "action", ["review_clarification", "project_review", "close_story", "complete_remedy"]
)
def test_reading_results_is_not_a_player_statement(action):
    event = Event(data={"kind": "player", "speaker": "system", "action": action, "act": 3})
    assert role_context(event)["actor"] == "unknown"


def test_review_submission_and_approval_are_distinguished():
    event = Event(data={"kind": "player", "speaker": "system", "action": "approve_purchase"})
    assert role_context(event)["player_action"] == "提交李姐审核"
    assert role_context(event)["actor"] == "player"


def test_rejects_reproduced_npc_reply_addressed_to_player():
    from app.artifact_quality import validate_advice

    fact = {"role_context": {"actor": "player", "player_name": "周菱菱"}}
    with pytest.raises(ValueError, match="speaks_as_npc"):
        validate_advice(fact, "周菱菱，欢送会我不替你决定，你想去就去。")


def test_rejects_reproduced_participation_owner_swap():
    from app.artifact_quality import validate_advice

    with pytest.raises(ValueError, match="swaps_participation"):
        validate_advice(
            {"role_context": {"actor": "player", "action": "speak"}},
            "我可以先问孙淼本人是否愿意参加活动，再决定要不要替他向李姐回话。",
        )
