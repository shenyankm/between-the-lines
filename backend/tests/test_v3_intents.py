import pytest

from app.intents import grounded_v3

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "text,action,npc,act",
    [
        ("欢送会的名单，可以把我加上吗？", "join_farewell", "sun", 1),
        ("既然知道我可能会生气，为什么不直接问我？", "boundary", "sun", 1),
        ("我不喜欢这种玩笑。", "boundary", "sun", 1),
        ("请李姐复核退回依据", "dispute_return", "li", 2),
        ("我希望继续做朋友", "repair_friendship", "sun", 3),
        ("我要结束这一局", "close_story", "sun", 3),
    ],
)
def test_clear_current_requests(text, action, npc, act):
    assert grounded_v3(text, action, npc, act)


@pytest.mark.parametrize(
    "text",
    [
        "她说“欢送会的名单，可以把我加上吗？”",
        "如果我问欢送会的名单，可以把我加上吗？",
        "我不想参加欢送会，别把我加入名单。",
        "欢送会的名单，可以把我加上吗？但是算了。",
        "欢送会的名单，可以把我加上吗？还是暂时忍让。",
    ],
)
def test_ambiguous_or_quoted_requests_do_not_execute(text):
    assert not grounded_v3(text, "join_farewell", "sun", 1)


def test_role_and_stage_still_control_available_intentions():
    assert not grounded_v3("请李姐复核退回依据", "dispute_return", "wang", 2)
    assert not grounded_v3("请李姐复核退回依据", "dispute_return", "li", 1)


def test_materials_statement_is_not_a_second_request():
    assert grounded_v3("材料齐全，请审核", "approve_purchase", "li", 2)
    assert not grounded_v3("材料齐全，请审核", "request_materials", "li", 2)
    assert grounded_v3("还缺哪些材料？", "request_materials", "li", 2)
    assert grounded_v3("请说明缺少材料", "request_materials", "sun", 2)


@pytest.mark.parametrize(
    "text",
    [
        "我不接受你替我决定，但是我愿意听你解释",
        "我希望你以后先问问我再替我作决定",
    ],
)
def test_explicit_boundary_with_polite_contrast(text):
    assert grounded_v3(text, "boundary", "sun", 1)
    assert not grounded_v3(text, "boundary", "zhang", 1)
    for wrapped in [f"她说“{text}”", f"如果{text}", f"{text}，但是算了", f"{text}，我要公开质问"]:
        assert not grounded_v3(wrapped, "boundary", "sun", 1)
