"""Keep historical v2 rules reproducible even though admission is now read-only."""

import pytest

from app.actions import available_actions, effects, role_actions, transition
from app.domain import RuleError, initial_state
from app.game_types import GameStateV2

pytestmark = pytest.mark.unit


def state(**changes):
    return GameStateV2(**(initial_state().model_dump() | changes))


@pytest.mark.parametrize(
    "choice,expected", [("partner_breakup", "breakup"), ("partner_distance", "distance")]
)
@pytest.mark.parametrize(
    "relationship,ending", [("cut_ties", "sun_cut"), ("keep_distance", "sun_observe")]
)
def test_historical_full_route_and_stable_ending(choice, expected, relationship, ending):
    s = state()
    for action, npc in [
        ("begin", "sun"),
        ("boundary", "sun"),
        ("public_confront", "sun"),
        ("verify_notice", "li"),
        ("contact_wang", "sun"),
        ("next", "sun"),
        ("request_materials", "li"),
        ("supplement", "sun"),
        ("report", "zhang"),
        ("support_project", "zhang"),
        ("joint_review", "li"),
        (choice, "sun"),
        ("next", "sun"),
        ("clarify", "sun"),
        ("deliver", "sun"),
        (relationship, "sun"),
        ("next", "sun"),
    ]:
        options = {row.action: row for row in available_actions(s)}
        assert action in options and options[action].enabled
        prior = s.model_copy(deep=True)
        s, text = transition(s, action, npc)
        assert prior != s
        assert effects(prior, s, text)
    assert s.partner_choice == expected
    assert s.ending_id == ending
    assert s.node == "ending"
    assert available_actions(s) == []
    assert transition(s, "epilogue")[0] == s
    assert effects(s, s, "") == []


@pytest.mark.parametrize(
    "changes,action,npc,reason",
    [
        ({"ending": "结束"}, "boundary", "sun", "结束"),
        ({"act": 3}, "cut_ties", "sun", "澄清"),
        ({"act": 2}, "joint_review", "zhang", "李姐"),
        ({"act": 2, "flags": ["joint_review"]}, "joint_review", "li", "已经"),
        ({"act": 2}, "joint_review", "li", "支持"),
        ({"act": 2}, "support_project", "sun", "权限"),
        ({"act": 2, "procurement": "approved"}, "approve_purchase", "li", "已经"),
        ({"act": 2, "flags": ["requirements"]}, "request_materials", "sun", "已经"),
        ({"act": 2, "flags": ["supported"]}, "support_project", "zhang", "已经"),
        ({"act": 1}, "verify_notice", "li", "争议"),
        ({"act": 1, "flags": ["confronted", "notice_checked"]}, "verify_notice", "li", "已经"),
        ({"act": 2}, "partner_distance", "sun", "采购"),
        (
            {"act": 2, "procurement": "approved", "partner_choice": "distance"},
            "partner_breakup",
            "sun",
            "已经",
        ),
        ({"act": 2, "procurement": "approved"}, "next", "sun", "幕间"),
    ],
)
def test_historical_rejection_does_not_modify_state(changes, action, npc, reason):
    before = state(**changes)
    snapshot = before.model_dump()
    with pytest.raises(RuleError, match=reason):
        transition(before, action, npc)
    assert before.model_dump() == snapshot


def test_finance_authority_private_choices_and_early_exit_remain_distinct():
    before = state(act=2, flags=["requirements", "materials"])
    approved, _ = transition(before, "approve_purchase", "li")
    assert approved.procurement == "approved"
    for npc in ["sun", "li", "zhang"]:
        actions = role_actions(before, npc)
        assert not any(a.action.startswith("partner_") for a in actions)
        if npc != "li":
            assert not any(a.action == "approve_purchase" for a in actions)
    assert any(
        a.action == "request_materials" and a.target == "li" for a in role_actions(before, "li")
    )
    for name in ["propose", "cancel_proposal"]:
        after, text = transition(before, name)
        assert after == before and after is not before and text == ""
    ended, _ = transition(state(act=1), "leave")
    assert ended.ending_id == "leave" and ended.partner_choice is None
    assert "personal_resolved" not in ended.flags
    assert transition(initial_state(), "begin")[0].act == 1
    assert available_actions(initial_state()) == []
