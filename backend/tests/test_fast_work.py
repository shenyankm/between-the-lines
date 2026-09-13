from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.agents import AgentGateway
from app.config import Settings
from app.context import AgentContext
from app.domain import RuleError
from app.fast_work import work_request
from app.story import load_story

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "text",
    [
        "不要审核采购",
        "如果我请审核采购会怎样",
        "他说‘请审核采购’",
        "请审核采购，但是先别通过",
        "请审核采购？为什么之前要我道歉？",
        "请落实实验排期支持，如果不能保证就不要操作",
        "请记住，我不想现在审核采购",
    ],
)
def test_mixed_negated_and_quoted_speech_never_takes_fast_path(text):
    assert work_request(text, "li", 2) is None
    assert work_request(text, "zhang", 2) is None


def test_role_and_act_permissions_are_not_bypassed():
    assert work_request("请审核采购。", "sun", 2) is None
    assert work_request("请审核采购。", "li", 1) is None
    assert work_request("请落实实验排期支持。", "li", 2) is None
    assert work_request("请审核采购。", "li", 2) == "approve_purchase"


@pytest.mark.parametrize("failure", [False, True])
async def test_fast_reply_waits_for_authoritative_operation_and_never_calls_model(failure):
    service = SimpleNamespace(
        context_for=AsyncMock(
            return_value=AgentContext(
                facts={"act": 2, "flags": [], "procurement": "pending"}, history=[]
            )
        ),
        npc_operation=AsyncMock(
            side_effect=RuleError("材料尚未补齐") if failure else None,
            return_value="李姐确认材料齐全，采购审核通过。",
        ),
    )
    factory = Mock(side_effect=AssertionError("Fast request must not construct a model"))
    gateway = AgentGateway(
        Settings(_env_file=None, agent_mode="mock"), service, load_story(), model_factory=factory
    )
    turn = SimpleNamespace(id="turn", input=SimpleNamespace(npc="li", text="请审核采购。"))
    usage = {}
    reply = "".join([chunk async for chunk in gateway.run_agent(turn, InMemorySaver(), usage)])
    service.npc_operation.assert_awaited_once_with("turn", "li", "approve_purchase")
    factory.assert_not_called()
    assert ("审核通过" in reply) is not failure
    assert ("材料尚未补齐" in reply) is failure
    assert not usage.get("model_calls")


async def test_gateway_reuses_transport_but_closes_it_only_at_shutdown(monkeypatch):
    model = SimpleNamespace(
        root_async_client=SimpleNamespace(close=AsyncMock()),
        root_client=SimpleNamespace(close=Mock()),
    )
    factory = Mock(return_value=model)
    monkeypatch.setattr("app.agents.make_model", factory)
    gateway = AgentGateway(
        Settings(_env_file=None, agent_mode="mock"), SimpleNamespace(), load_story()
    )
    assert gateway.model_factory() is gateway.model_factory()
    factory.assert_called_once()
    await gateway._release_model(model)
    model.root_async_client.close.assert_not_called()
    await gateway.close()
    model.root_async_client.close.assert_awaited_once()
    model.root_client.close.assert_called_once()
    await gateway.close()
    model.root_async_client.close.assert_awaited_once()
