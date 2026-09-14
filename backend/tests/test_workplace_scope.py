import pytest

from app.actions import role_actions
from app.game_types import initial_v3
from app.story import load_story
from app.story_rules import transition_v3

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("revision", [2, 3])
def test_workplace_can_finish_without_any_automatic_private_choice(revision):
    state = initial_v3()
    state.content_revision = revision
    for action in ["begin", "next", "next", "close_story"]:
        state, _ = transition_v3(state, action)
        assert state.partner_choice is None
        assert not any(flag.startswith("partner_") for flag in state.flags)
        for npc in ("sun", "li", "zhang"):
            assert not any(a.action.startswith("partner_") for a in role_actions(state, npc))
    assert state.ending
    assert all(not act.interlude for act in load_story(3, revision).acts)
