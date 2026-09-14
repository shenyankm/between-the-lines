"""Content revisions must not reinterpret existing saves or permit new writes."""

from uuid import uuid4

import pytest

from app.game_types import initial_v3, parse_state
from app.schemas import SaveOut
from app.story import load_story

pytestmark = pytest.mark.unit


def test_missing_revision_stays_original_and_readonly():
    state = initial_v3().model_dump()
    state.pop("content_revision")
    parsed = parse_state(state)
    assert parsed.content_revision == 1
    save = SaveOut(id=str(uuid4()), version=0, story_version=3, state=state)
    assert save.read_only
    assert save.scene_intro == load_story(3, 1).scene_intro(parsed)


def test_new_content_revision_is_explicit_and_playable():
    state = initial_v3()
    assert state.content_revision == 2
    assert not SaveOut(id=str(uuid4()), version=0, story_version=3, state=state).read_only


def test_original_story_remains_addressable():
    original = load_story(3, 1)
    assert (
        original.scenes["act_1"][0].text
        == "王会计的欢送会，你会来吗？我想着你可能不喜欢这种场合，就没再问。"
    )
    assert load_story(3, 2) is not original
    assert original.player_name == "周凌"
    assert load_story(3, 2).player_name == "周菱菱"


def test_relationship_projection_uses_current_intention_not_old_flag_order():
    state = initial_v3()
    state.relationship.intention = "friendship"
    state.flags = ["sun_cut", "sun_observe"]
    person = next(row for row in load_story(3).relationships_for(state) if row.id == "sun")
    assert "希望保留友谊" in person.description
    assert "对方尚未回应" in person.description
    assert "已结束私人来往" not in person.description


def test_performance_preserves_purchase_facts_without_promising_delivery():
    from app.game_types import Fact

    state = initial_v3()
    state.act = 3
    state.node = "act_3"
    story = load_story(3)
    pending = story.performance_for(state)
    assert "还没有完全结束" in pending[0].text
    assert "按计划交付" not in pending[3].text
    state.work.facts["purchase_approved"] = Fact(event_id=str(uuid4()), detail="审核通过")
    approved = story.performance_for(state)
    assert "已经通过" in approved[0].text
    assert "还没有完全结束" in story.scenes["act_3"][0].text
    assert "没有做出决定" not in approved[3].text
