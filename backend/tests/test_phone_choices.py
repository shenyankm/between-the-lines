import pytest

from app.phone_choices import phone_choice

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "text,channel,npc,expected",
    [
        ("我没有决定跳槽，请不要继续传播。", "group", "sun", "clarify"),
        ("跳槽的说法不属实。", "group", "sun", "clarify"),
        ("向你同步项目事实：交付节点仍按原计划推进。", "dm", "zhang", "report"),
        ("汇报一下当前进度，测试已经完成。", "dm", "zhang", "report"),
        ("李姐，请确认谣言最初是从哪里传出的。", "dm", "li", "trace_rumor"),
        ("跳槽的消息是谁传出的？", "dm", "li", "trace_rumor"),
        ("我没有决定跳槽。", "dm", "sun", None),
        ("向你同步项目事实。", "dm", "sun", None),
        ("请确认谣言是从哪里传出的。", "dm", "zhang", None),
        ("我准备向你同步项目事实。", "dm", "zhang", None),
        ("不要同步项目事实。", "dm", "zhang", None),
        ("不要确认谣言是谁传出的。", "dm", "li", None),
        ("如果我没有决定跳槽。", "group", "sun", None),
        ("她说“我没有决定跳槽”。", "group", "sun", None),
        ("我稍后澄清跳槽的说法不属实。", "group", "sun", None),
        ("你好。", "dm", "li", None),
        ("项目目前按计划推进，测试已经完成。", "dm", "zhang", "report"),
        ("项目目前按计划推进了吗？", "dm", "zhang", None),
        ("我没有同步项目事实。", "dm", "zhang", None),
        ("我会同步项目事实。", "dm", "zhang", None),
        ("我不认为跳槽的说法不属实。", "group", "sun", None),
    ],
)
def test_phone_choices_require_current_sent_expression(text, channel, npc, expected):
    assert phone_choice(text, channel, npc) == expected


@pytest.mark.parametrize("selected", ["clarify", "report", "trace_rumor"])
def test_rumor_choice_blocks_other_actions_but_allows_conversation(selected):
    from app.actions import available_actions
    from app.domain import RuleError
    from app.game_types import initial_v3
    from app.story_rules import CATALOG, transition_v3

    state = initial_v3()
    state.act = 3
    state.node = "act_3"
    state, _ = transition_v3(state, selected, CATALOG[selected][2] or "sun")
    for other in {"clarify", "report", "trace_rumor"} - {selected}:
        with pytest.raises(RuleError, match="不能改选"):
            transition_v3(state, other, CATALOG[other][2] or "sun")
    assert (
        sum(
            a.completed
            for a in available_actions(state)
            if a.action in {"clarify", "report", "trace_rumor"}
        )
        == 1
    )
    transition_v3(state, "speak")


def test_legacy_multiple_results_select_first_without_erasing_facts():
    from app.actions import available_actions
    from app.game_types import initial_v3

    state = initial_v3()
    state.act = 3
    state.node = "act_3"
    state.flags = ["reported:act_2", "rumor_verified", "clarification_sent", "reported:act_3"]
    before = state.model_dump()
    choices = [
        a for a in available_actions(state) if a.action in {"clarify", "report", "trace_rumor"}
    ]
    assert [a.action for a in choices if a.completed] == ["trace_rumor"]
    assert not any(a.enabled for a in choices)
    assert state.model_dump() == before
