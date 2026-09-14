import pytest

from app.domain import RuleError
from app.game_types import initial_v3
from app.intents import grounded
from app.story_rules import CATALOG, ending_for, transition_v3

pytestmark = pytest.mark.unit


def play(*actions):
    state = initial_v3()
    for index, action in enumerate(actions):
        target = CATALOG[action][2] or "sun"
        state, _ = transition_v3(
            state,
            action,
            target,
            params={"evidence": ["quote", "purpose", "urgency"]}
            if action == "supplement"
            else {"boundary_response": "decline"}
            if action == "follow_up"
            else None,
            event_id=f"event-{index}",
        )
    return state


BASE = [
    "begin",
    "boundary",
    "next",
    "supplement",
    "approve_purchase",
    "next",
    "clarify",
    "review_clarification",
    "deliver",
]


@pytest.mark.parametrize(
    "path,ending",
    [
        (["begin", "draft_exit", "submit_exit"], "active_exit"),
        (["begin", "next", "next", "project_review", "close_story"], "career_cost"),
        (
            [
                *BASE,
                "dispute_return",
                "confirm_responsibility",
                "change_rules",
                "project_review",
                "apply_rules",
                "close_story",
            ],
            "rules_rewritten",
        ),
        (
            [
                *BASE,
                "repair_friendship",
                "acknowledge_harm",
                "complete_remedy",
                "project_review",
                "follow_up",
                "close_story",
            ],
            "limited_repair",
        ),
        (
            [*BASE, "cut_ties", "project_review", "follow_up", "close_story"],
            "professional_boundary",
        ),
        (["begin", "next", "next", "close_story"], "unresolved"),
    ],
)
def test_complete_routes(path, ending):
    s = play(*path)
    assert s.outcome.id == ending
    assert s.act == 4
    assert all(f.event_id.startswith("event-") for f in s.work.facts.values())


def test_honest_facts_and_priority():
    assert ending_for(play(*BASE, "repair_friendship", "acknowledge_harm")).id == "unresolved"
    assert ending_for(play("begin", "draft_exit")).id == "unresolved"
    s = play(
        "begin",
        "next",
        "next",
        "project_review",
        "supplement",
        "approve_purchase",
        "deliver",
        "correct_loss",
        "close_story",
    )
    assert s.outcome.id == "unresolved"
    s = play(*BASE, "cut_ties", "project_review", "follow_up", "draft_exit", "submit_exit")
    assert s.outcome.id == "active_exit"
    assert s.outcome.achievements


def test_no_repeat_score_or_chat_clock():
    s = play("begin", "boundary")
    with pytest.raises(RuleError):
        transition_v3(s, "boundary")
    after, _ = transition_v3(s, "speak")
    assert after.tick == s.tick
    assert after.pressure == s.pressure
    assert after.quiet_turns == 1
    s = play(
        "begin",
        "appease",
        "public_confront",
        "next",
        "appease",
        "next",
        "appease",
        "project_review",
    )
    # Revision 3 scores restraint once, while project loss still has its cost.
    assert s.rumination == 50
    assert s.pressure == 65
    assert not s.ending


def test_permissions():
    s = play("begin", "next", "supplement")
    for npc in ["sun", "zhang", "wang"]:
        with pytest.raises(RuleError):
            transition_v3(s, "approve_purchase", npc)


@pytest.mark.parametrize("text", ["既然知道我可能会生气，为什么不直接问我？", "我不喜欢这种玩笑。"])
def test_original_boundary_lines(text):
    assert grounded(text, "boundary", "sun", 1)


@pytest.mark.parametrize(
    "text", ["她说“我不喜欢这种玩笑。”", "如果我不喜欢这种玩笑呢？", "我不想表达边界。"]
)
def test_ambiguous_lines(text):
    assert not grounded(text, "boundary", "sun", 1)


def test_farewell_participation_is_not_assumed():
    state = play("begin")
    assert "farewell_attended" not in state.work.facts
    with pytest.raises(RuleError):
        transition_v3(state, "attend_farewell")
    state, _ = transition_v3(state, "join_farewell", event_id="request")
    assert state.node == "act_1_invitation"
    assert "farewell_attended" not in state.work.facts
    state, _ = transition_v3(state, "attend_farewell", event_id="visit")
    assert state.node == "act_1_farewell"
    assert state.work.facts["farewell_attended"].event_id == "visit"


def test_purchase_starts_with_original_evidence_and_vague_return():
    state = play("begin", "next")
    assert state.work.purchase == "returned"
    assert state.pressure == 40
    assert state.work.submissions[0].evidence == ["quote", "purpose"]
    assert state.work.reviews[0].detail == "材料不符合要求"
    assert state.work.reviews[0].time == "2026-09-08 14:32"
    assert state.work.submissions[0].submitted_at == "2026-09-07 09:20"
    with pytest.raises(RuleError):
        transition_v3(state, "submit_purchase")
    # A review can establish compliance without inventing missing attachments.
    state, _ = transition_v3(state, "dispute_return", "li", event_id="review")
    assert state.work.purchase == "review"
    state, _ = transition_v3(state, "approve_purchase", "li", event_id="approval")
    assert state.work.purchase == "approved"
    assert len(state.work.submissions) == 1
    assert state.work.reviews[-1].version == 1
    assert state.work.reviews[-1].event_id == "approval"


def test_supplement_never_invents_selected_attachments():
    state = play("begin", "next")
    with pytest.raises(RuleError):
        transition_v3(state, "supplement")
    with pytest.raises(RuleError):
        transition_v3(state, "supplement", params={"evidence": ["purpose"]})
    state, _ = transition_v3(state, "supplement", params={"evidence": ["purpose", "quote"]})
    assert "urgency" not in state.work.submissions[-1].evidence
    assert state.work.submissions[-1].version == 2


def test_sending_clarification_does_not_resolve_rumor():
    state = play(
        "begin",
        "next",
        "dispute_return",
        "approve_purchase",
        "next",
        "deliver",
        "clarify",
        "confirm_responsibility",
    )
    assert "clarification_sent" in state.work.facts
    assert "clarified" not in state.work.facts
    with pytest.raises(RuleError):
        transition_v3(state, "change_rules", "li")
    assert ending_for(state).id == "unresolved"
    state, text = transition_v3(state, "review_clarification", event_id="group-correction")
    assert "更正" in text and "仍没有查实" in text
    assert state.work.facts["clarified"].event_id == "group-correction"
    state, _ = transition_v3(state, "change_rules", "li")
    assert ending_for(state).id != "rules_rewritten"
    state, _ = transition_v3(state, "project_review", "zhang")
    state, _ = transition_v3(state, "apply_rules", "li")
    assert ending_for(state).id == "rules_rewritten"


def test_cannot_invent_group_correction_before_clarification():
    with pytest.raises(RuleError):
        transition_v3(play("begin", "next", "next"), "review_clarification")


def test_friendship_offer_does_not_create_mutual_willingness():
    state = play("begin", "next", "next", "repair_friendship")
    assert "friendship_offer" in state.relationship.facts
    assert "friendship" not in state.relationship.facts
    state, _ = transition_v3(state, "acknowledge_harm", event_id="sun-response")
    assert state.relationship.facts["friendship"].event_id == "sun-response"
    assert "remedy" not in state.relationship.facts
    state, text = transition_v3(state, "complete_remedy", event_id="correction")
    assert "无法" in text and "后续工作" in state.relationship.facts["remedy"].detail
    assert ending_for(state).id != "limited_repair"


def test_repair_remembers_actual_farewell_attendance():
    state = play(
        "begin",
        "join_farewell",
        "attend_farewell",
        "next",
        "next",
        "repair_friendship",
        "acknowledge_harm",
    )
    state, text = transition_v3(state, "complete_remedy", event_id="remedy-after-attendance")
    assert "已经参加" in text
    assert "错过" not in text
    assert "错过" not in state.relationship.facts["remedy"].detail


@pytest.mark.parametrize(
    "response,expected",
    [("decline", "尊重你的安排"), ("agree", "以后也会先问"), ("ask_details", "等你决定")],
)
def test_followup_requires_and_preserves_actual_response(response, expected):
    state = play(*BASE, "cut_ties", "project_review")
    with pytest.raises(RuleError):
        transition_v3(state, "follow_up")
    state, text = transition_v3(
        state, "follow_up", params={"boundary_response": response}, event_id="actual-response"
    )
    assert expected in text
    assert state.relationship.facts["follow_up"].event_id == "actual-response"
    if response != "decline":
        assert "拒绝" not in state.relationship.facts["follow_up"].detail


def test_confirmed_rules_need_actual_later_application():
    state = play(*BASE, "dispute_return", "confirm_responsibility", "change_rules")
    assert "rules_proposed" in state.work.facts
    assert "rules_changed" not in state.work.facts
    with pytest.raises(RuleError):
        transition_v3(state, "apply_rules", "li")
    state, _ = transition_v3(state, "project_review", "zhang")
    state, _ = transition_v3(state, "apply_rules", "li", event_id="applied")
    assert state.work.facts["rules_changed"].event_id == "applied"
    assert ending_for(state).id == "rules_rewritten"


@pytest.mark.parametrize("kind,completion", [("leave", "rest"), ("help", "request_help")])
def test_support_application_only_scores_after_implementation(kind, completion):
    state = play("begin")
    pressure = state.pressure
    with pytest.raises(RuleError):
        transition_v3(state, completion, CATALOG[completion][2] or "sun")
    state, _ = transition_v3(
        state,
        "draft_support",
        params={
            "support_kind": kind,
            "reason": "需要恢复精力",
            "plan": "交接实验记录，张工协调紧急事项",
        },
        event_id="draft",
    )
    assert state.support_requests[-1].submitted is None and state.pressure == pressure
    with pytest.raises(RuleError):
        transition_v3(state, "review_support", "zhang")
    state, _ = transition_v3(state, "submit_support", event_id="submitted")
    assert state.pressure == pressure
    with pytest.raises(RuleError):
        transition_v3(state, completion, CATALOG[completion][2] or "sun")
    with pytest.raises(RuleError):
        transition_v3(state, "review_support", "sun")
    state, _ = transition_v3(state, "review_support", "zhang", event_id="approved")
    assert state.pressure == pressure
    state, _ = transition_v3(
        state, completion, CATALOG[completion][2] or "sun", event_id="completed"
    )
    assert state.pressure == pressure - 10
    assert state.support_requests[-1].completion.event_id == "completed"
    with pytest.raises(RuleError):
        transition_v3(state, completion, CATALOG[completion][2] or "sun")


def test_submitted_support_application_cannot_be_overwritten():
    state = play("begin")
    params = {"support_kind": "leave", "reason": "休息", "plan": "交接已列明"}
    state, _ = transition_v3(state, "draft_support", params=params)
    state, _ = transition_v3(state, "submit_support")
    with pytest.raises(RuleError):
        transition_v3(state, "draft_support", params={**params, "reason": "覆盖前一份申请"})
    assert state.support_requests[-1].reason == "休息"


def test_early_exit_does_not_invent_future_work_conflicts():
    state = play("begin", "draft_exit", "submit_exit")
    assert state.outcome.unresolved == []
    assert any("手续仍待后续办理" in item for item in state.outcome.achievements)
    assert not any("谣言" in item for item in state.outcome.achievements)


@pytest.mark.parametrize("revision", [2, 3])
@pytest.mark.parametrize("choice", ["appease", "boundary", "join_farewell"])
def test_first_response_is_exclusive_and_advances_scene(revision, choice):
    from app.actions import available_actions
    from app.story import load_story

    state = play("begin")
    state.content_revision = revision
    chosen, _ = transition_v3(state, choice, event_id="first-response")
    assert chosen.node != state.node
    assert load_story(3, revision).performance_for(chosen)
    before = chosen.model_dump()
    for other in ("appease", "boundary", "join_farewell"):
        with pytest.raises(RuleError, match="这次回应已经作出"):
            transition_v3(chosen, other)
    assert chosen.model_dump() == before
    assert not any(
        a.enabled
        for a in available_actions(chosen)
        if a.action in {"appease", "boundary", "join_farewell"}
    )
    continued, _ = transition_v3(chosen, "next")
    assert continued.act == 2
    if choice == "join_farewell":
        attending, _ = transition_v3(chosen, "attend_farewell")
        assert attending.node == "act_1_farewell"


def test_existing_multiple_response_flags_are_preserved_but_cannot_add_another():
    state = play("begin", "appease")
    state.node = "act_1"
    state.flags.append("boundary:act_1")
    before = state.model_dump()
    with pytest.raises(RuleError, match="这次回应已经作出"):
        transition_v3(state, "join_farewell")
    assert state.model_dump() == before


@pytest.mark.parametrize("revision", [2, 3])
def test_act_three_follows_document_dialogue_order(revision):
    from app.story import load_story

    state = initial_v3()
    state.content_revision = revision
    state.act = 3
    state.node = "act_3"
    story = load_story(3, revision)
    before = state.model_dump()
    lines = story.performance_for(state)
    assert [line.speaker for line in lines] == [
        "narrator",
        "group",
        "zhang",
        "player",
        "zhang",
    ]
    assert "采购单的事情还没有完全结束" in lines[0].text
    assert "听说周菱菱准备跳槽了" in lines[1].text
    assert "最近项目进度需要重新确认" in lines[2].text
    assert (
        lines[3].text
        == "项目没有问题，我会按计划交付。\n至于跳槽的事情，我没有说过，也没有做出决定。"
    )
    assert story.acts[3].title == "第三幕 · 谣言战"
    assert lines[1].portraits == ["player"]
    assert lines[2].portraits == ["player", "zhang"]
    assert "项目节点和交付记录整理给我" in lines[4].text
    assert [choice.action for choice in story.acts[3].choices] == [
        "clarify",
        "report",
        "trace_rumor",
    ]
    assert state.model_dump() == before
