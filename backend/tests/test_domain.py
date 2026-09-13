import pytest

from app.config import Settings
from app.domain import RuleError, apply_npc, apply_player, initial_state, visible_state

pytestmark = pytest.mark.unit


def purchase_state():
    state, _ = apply_player(initial_state(), "begin")
    state, _ = apply_player(state, "boundary")
    return apply_player(state, "next")[0]


def test_complete_boundary_path():
    state = purchase_state()
    state, _ = apply_npc(state, "sun", "request_materials")
    state, _ = apply_player(state, "supplement")
    state, _ = apply_player(state, "report")
    state, _ = apply_npc(state, "zhang", "support_project")
    state, _ = apply_npc(state, "li", "approve_purchase")
    state, _ = apply_player(state, "next")
    state, _ = apply_player(state, "clarify")
    state, _ = apply_player(state, "deliver")
    state, _ = apply_player(state, "next")
    assert state.ending == "保持职业关系和边界"
    assert state.credit == 90


def test_authority_and_preconditions():
    state = purchase_state()
    with pytest.raises(RuleError):
        apply_npc(state, "sun", "approve_purchase")
    with pytest.raises(RuleError):
        apply_npc(state, "zhang", "approve_purchase")
    with pytest.raises(RuleError):
        apply_npc(state, "li", "approve_purchase")
    with pytest.raises(RuleError):
        apply_player(state, "supplement")
    with pytest.raises(RuleError):
        apply_player(state, "next")


def test_no_repeated_score_and_private_facts():
    state = purchase_state()
    state, _ = apply_player(state, "report")
    with pytest.raises(RuleError):
        apply_player(state, "report")
    assert "reported" not in visible_state(state, "sun")["flags"]
    assert "reported" in visible_state(state, "zhang")["flags"]
    assert "stress" not in visible_state(state, "sun")


def test_leaving_is_a_choice():
    state = purchase_state()
    state.stress = 100
    assert apply_player(state, "speak")[0].ending is None
    state, _ = apply_player(state, "leave")
    assert state.ending == "主动离开"


def test_production_forbids_mock_identity_and_agents():
    with pytest.raises(ValueError):
        Settings(environment="production", agent_mode="mock", dev_login_enabled=True)
