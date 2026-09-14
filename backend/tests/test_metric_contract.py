import pytest

from app.domain import visible_state
from app.game_types import Fact, initial_v3
from app.story_rules import ending_for, transition_v3

pytestmark = pytest.mark.unit


def test_values_do_not_replace_facts_or_escape_npc_isolation():
    state = initial_v3()
    state.act = 3
    state.relationship.intention = "professional"
    for key in ("purchase_approved", "clarified", "delivered"):
        state.work.facts[key] = Fact(event_id=key, detail=key)
    state.relationship.facts["follow_up"] = Fact(event_id="follow_up", detail="verified")
    for number in (5, 95):
        for metric in ("credit", "rumination", "pressure", "heat"):
            setattr(state, metric, number)
        assert ending_for(state).id == "professional_boundary"
        for npc in ("sun", "li", "zhang", "wang"):
            assert (
                not {"credit", "rumination", "pressure", "heat"} & visible_state(state, npc).keys()
            )
    state.work.facts.pop("delivered")
    assert ending_for(state).id == "unresolved"


@pytest.mark.parametrize("heat", [69, 70])
def test_company_review_is_event_backed_without_automatic_resolution(heat):
    state = initial_v3()
    state.act = 1
    state.heat = heat
    after, _ = transition_v3(state, "boundary", "sun", event_id="observed")
    assert ("company_review" in after.work.facts) is (heat >= 70)
    if heat >= 70:
        assert after.work.facts["company_review"].event_id == "observed"
    assert "clarified" not in after.work.facts
