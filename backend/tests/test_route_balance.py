import pytest

from app.domain import RuleError
from app.game_types import initial_v3
from app.story_rules import transition_v3

pytestmark = pytest.mark.unit


def act(state, action, npc="sun", **params):
    return transition_v3(state, action, npc, params, event_id=action)[0]


def purchase(revision=3):
    state = initial_v3()
    state.content_revision = revision
    return act(act(state, "begin"), "next")


def test_existing_revision_keeps_its_original_scoring():
    state = purchase(2)
    supplemented = act(state, "supplement", evidence=["quote", "purpose"])
    disputed = act(state, "dispute_return", "li")
    assert supplemented.credit == state.credit + 10
    assert disputed.credit == state.credit


def test_qualified_original_rewards_correction_not_mechanical_resubmission():
    state = purchase()
    copied = act(state, "supplement", evidence=["quote", "purpose"])
    corrected = act(state, "dispute_return", "li")
    assert copied.credit == state.credit
    assert corrected.credit == state.credit + 10
    assert corrected.pressure == state.pressure - 5
    after_copy = act(copied, "dispute_return", "li")
    assert after_copy.credit == corrected.credit
    assert act(corrected, "next").credit == corrected.credit
    with pytest.raises(RuleError):
        act(corrected, "dispute_return", "li")


def test_actual_missing_materials_and_urgent_requirements_are_not_bypassed():
    state = purchase()
    state.work.submissions[-1].kind = "urgent"
    disputed = act(state, "dispute_return", "li")
    assert "materials" not in disputed.work.facts
    assert disputed.credit == state.credit
    with pytest.raises(RuleError):
        act(disputed, "supplement", evidence=["quote", "purpose"])
    fixed = act(disputed, "supplement", evidence=["quote", "purpose", "urgency"])
    assert fixed.credit == state.credit + 10
    with pytest.raises(RuleError):
        act(fixed, "approve_purchase", "sun")
    assert act(fixed, "approve_purchase", "li").work.purchase == "approved"


def test_public_expression_uses_evidence_and_each_cost_is_scored_once():
    state = purchase()
    unsupported = act(state, "public_confront")
    verified = act(state, "dispute_return", "li")
    supported = act(verified, "public_confront")
    assert unsupported.credit == state.credit - 5
    assert supported.credit == verified.credit
    assert supported.heat == verified.heat + 20
    restrained = act(state, "appease")
    assert restrained.pressure == state.pressure - 5
    assert restrained.rumination == state.rumination + 5
    next_act = act(restrained, "next")
    assert act(next_act, "appease").pressure == next_act.pressure
    boundary = act(state, "boundary")
    next_act = act(boundary, "next")
    assert act(next_act, "boundary").credit == next_act.credit
