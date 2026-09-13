import json

import pytest

from app.domain import RuleError, apply_npc, apply_player, initial_state, visible_state
from app.game_types import GameState
from app.mock_llm import completion
from app.schemas import SaveOut
from app.story import load_story

pytestmark = pytest.mark.unit


def third_act(early="boundary"):
    state = initial_state()
    for action in ("begin", early, "next"):
        state, _ = apply_player(state, action)
    state, _ = apply_npc(state, "li", "request_materials")
    state, _ = apply_player(state, "supplement")
    state, _ = apply_npc(state, "li", "approve_purchase")
    return apply_player(state, "next")[0]


def ready(early="boundary"):
    state = third_act(early)
    for action in ("clarify", "deliver"):
        state, _ = apply_player(state, action)
    return state


@pytest.mark.parametrize("early", ["boundary", "contact_wang", "public_confront"])
@pytest.mark.parametrize(
    "choice,flag,title",
    [
        ("cut_ties", "sun_cut", "找回自我 · 只留工作往来"),
        ("keep_distance", "sun_observe", "保持距离 · 继续观察"),
    ],
)
def test_final_choice_overrides_early_reactions(early, choice, flag, title):
    state = ready(early)
    scores = (state.credit, state.stress, state.heat)
    state, _ = apply_player(state, choice)
    assert flag in state.flags
    assert (state.credit, state.stress, state.heat) == scores
    state, _ = apply_player(state, "next")
    assert state.ending == title
    summary = load_story().ending_summary(state)
    assert "张工实际提供" not in summary  # Support was never requested.
    assert "你与谢川已分手" in summary
    if early == "public_confront":
        assert "曾当众质问" in summary


def test_confront_then_boundary_can_still_end_private_contact():
    state, _ = apply_player(initial_state(), "begin")
    state, _ = apply_player(state, "public_confront")
    state, _ = apply_player(state, "boundary")
    state.act = 3
    state.flags += ["clarified", "delivered"]
    state, _ = apply_player(state, "cut_ties")
    assert apply_player(state, "next")[0].ending == "找回自我 · 只留工作往来"


@pytest.mark.parametrize("choice", ["cut_ties", "keep_distance"])
def test_choice_requires_third_act_and_both_work_facts(choice):
    for state in (
        initial_state(),
        third_act(),
        apply_player(third_act(), "clarify")[0],
        apply_player(third_act(), "deliver")[0],
    ):
        original = state.model_dump()
        with pytest.raises(RuleError):
            apply_player(state, choice)
        assert state.model_dump() == original
    with pytest.raises(RuleError, match="私人关系"):
        apply_player(ready(), "next")


@pytest.mark.parametrize("choice", ["cut_ties", "keep_distance"])
def test_choice_is_mutually_exclusive_and_not_repeatable(choice):
    state, _ = apply_player(ready(), choice)
    for action in ("cut_ties", "keep_distance"):
        with pytest.raises(RuleError, match="已经记录"):
            apply_player(state, action)


def test_private_story_is_not_in_role_facts():
    state = ready("contact_wang")
    state, _ = apply_player(state, "cut_ties")
    for npc in ("sun", "li", "zhang"):
        facts = visible_state(state, npc)
        assert not {"wang_contacted", "reflection", "personal_resolved"} & set(facts["flags"])
        assert ("sun_cut" in facts["flags"]) == (npc == "sun")


def test_early_departure_does_not_complete_private_story():
    story = load_story()
    initial = story.relationships_for(initial_state())
    assert "已分手" not in json.dumps([r.model_dump() for r in initial], ensure_ascii=False)
    state, _ = apply_player(initial_state(), "begin")
    state, _ = apply_player(state, "leave")
    assert "personal_resolved" not in state.flags
    assert "你与谢川已分手" not in story.ending_summary(state)
    assert "前男友" not in next(
        r.description for r in story.relationships_for(state) if r.id == "xie"
    )
    late, _ = apply_player(third_act(), "leave")
    assert "你与谢川已分手" in story.ending_summary(late)


@pytest.mark.parametrize("ending", ["撕破脸", "关系重新协商", "保持职业关系和边界", "主动离开"])
def test_legacy_completed_saves_are_projected_without_rewriting(ending):
    state = GameState(
        act=4,
        credit=80,
        stress=10,
        heat=20,
        flags=["boundary", "delivered"],
        procurement="approved",
        ending=ending,
    )
    old = {"id": "old", "version": 9, "state": state.model_dump()}
    projected = SaveOut.model_validate(old).model_dump()
    assert projected["state"] == old["state"]
    assert projected["version"] == 9
    assert projected["ending_summary"].startswith("旧版结局")
    assert not any("前男友" in r["description"] for r in projected["relationships"])
    assert "persona" not in json.dumps(projected)


def test_legacy_unfinished_save_adopts_choice_and_persists_private_transition():
    state = ready()
    state.flags = [
        f for f in state.flags if f not in {"relationship_story", "reflection", "personal_resolved"}
    ]
    with pytest.raises(RuleError):
        apply_player(state, "next")
    state, _ = apply_player(state, "cut_ties")
    state, _ = apply_player(state, "next")
    assert "personal_resolved" in state.flags
    assert load_story().ending_summary(state).startswith("主线结局")


def test_support_summary_and_greetings_only_reflect_committed_facts():
    story = load_story()
    state = ready()
    state, _ = apply_player(state, "cut_ties")
    state, _ = apply_player(state, "next")
    assert "张工实际提供" not in story.ending_summary(state)
    state.flags += ["reported", "supported"]
    assert "张工实际提供" in story.ending_summary(state)
    assert "已了解" not in story.greeting_for("zhang", 2, [])
    assert "已了解" in story.greeting_for("zhang", 2, ["supported"])
    assert "周工" in story.greeting_for("zhang", 3, ["delivered"])
    assert "工作" in story.greeting_for("sun", 3, ["sun_cut"])


def test_mock_does_not_claim_private_wang_reply_and_respects_cut():
    for npc, persona in [("li", "你是李姐"), ("sun", "你是孙淼")]:
        state = ready("contact_wang")
        state, _ = apply_player(state, "cut_ties")
        payload = {
            "messages": [
                {"role": "system", "content": persona},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "最新可见事实": visible_state(state, npc),
                            "当前角色ID": npc,
                            "可见对话": [],
                        }
                    ),
                },
            ]
        }
        reply = completion(payload)["content"]
        assert "王叔" not in reply
        if npc == "sun":
            assert "只沟通工作" in reply
