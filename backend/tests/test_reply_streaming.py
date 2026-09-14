import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk
from langgraph.checkpoint.memory import InMemorySaver

from app.agents import AgentGateway
from app.config import Settings
from app.context import AgentContext
from app.fast_work import fast_work_operation
from app.runner import TurnRunner
from app.story import load_story

pytestmark = pytest.mark.unit


def turn(text="你好"):
    return SimpleNamespace(
        id="turn",
        user_id="user",
        save_id="save",
        input=SimpleNamespace(npc="sun", text=text, action="speak", channel="scene"),
    )


async def test_only_explicit_final_answer_tokens_are_previewed():
    class Graph:
        async def astream(self, *args, **kwargs):
            for content in [
                [{"type": "reasoning", "text": "SECRET"}],
                [{"type": "text", "phase": "commentary", "index": 0, "text": "TOOL PLAN"}],
                [{"type": "text", "phase": "final_answer", "index": 1, "text": "我们"}],
                [{"type": "text", "index": 1, "text": "核对记录。"}],
            ]:
                yield "messages", (AIMessageChunk(id="message", content=content), {})
            yield (
                "updates",
                {
                    "model": {
                        "messages": [
                            AIMessage(
                                content=[
                                    {"type": "reasoning", "text": "SECRET"},
                                    {"type": "text", "phase": "commentary", "text": "TOOL PLAN"},
                                    {
                                        "type": "text",
                                        "phase": "final_answer",
                                        "text": "我们核对记录。",
                                    },
                                ],
                                usage_metadata={
                                    "input_tokens": 3,
                                    "output_tokens": 2,
                                    "total_tokens": 5,
                                },
                            )
                        ]
                    }
                },
            )

    context = AgentContext(
        story_version=3, facts={"act": 1, "flags": [], "procurement": "pending"}, history=[]
    )
    service = SimpleNamespace(context_for=AsyncMock(return_value=context))
    model = SimpleNamespace(
        root_async_client=SimpleNamespace(close=AsyncMock()),
        root_client=SimpleNamespace(close=Mock()),
    )
    gateway = AgentGateway(
        Settings(_env_file=None, agent_mode="openai"), service, load_story(), lambda: model
    )
    gateway.build_agent = lambda *a, **k: Graph()
    usage = {}
    parts = [chunk async for chunk in gateway.run_agent(turn(), InMemorySaver(), usage)]
    assert parts == ["我们", "核对记录。"]
    assert usage["model_calls"] == 1
    assert usage["total_tokens"] == 5


@pytest.mark.parametrize("fails", [False, True])
async def test_preview_is_ephemeral_and_failure_does_not_save_partial_prose(fails):
    entered, release = asyncio.Event(), asyncio.Event()

    async def reply(*args):
        yield "未完成的开头"
        entered.set()
        await release.wait()
        if fails:
            raise TimeoutError()
        yield "，完整结尾。"

    service = SimpleNamespace(
        finish_turn=AsyncMock(return_value={"status": "failed" if fails else "completed"})
    )
    runner = TurnRunner(
        Settings(_env_file=None, agent_mode="mock"), service, None, reply, AsyncMock(), Mock()
    )
    t = asyncio.create_task(runner.execute(turn(), object()))
    await asyncio.wait_for(entered.wait(), 2)
    assert runner.live_replies == {"turn": "未完成的开头"}
    assert not service.finish_turn.called
    release.set()
    await t
    assert runner.live_replies == {}
    saved = service.finish_turn.call_args.args
    assert saved[3] == fails
    if fails:
        assert "未完成的开头" not in saved[1]
    else:
        assert saved[1] == "未完成的开头，完整结尾。"


@pytest.mark.parametrize(
    "text",
    [
        "不要审核采购",
        "如果材料齐了请审核采购",
        "“请审核采购”",
        "请审核采购，但是先别提交",
        "请审核采购并公开所有私聊",
    ],
)
def test_shortcuts_never_interpret_negation_quotes_or_mixed_requests(text):
    assert fast_work_operation(text, "li", 2) is None


def test_shortcut_respects_role_and_act():
    assert fast_work_operation("请审核采购。", "li", 2) == "approve_purchase"
    assert fast_work_operation("请审核采购", "sun", 2) is None
    assert fast_work_operation("请审核采购", "li", 1) is None


async def test_shared_transport_keeps_a_separate_call_budget_for_each_turn():
    context = AgentContext(
        story_version=3, facts={"act": 1, "flags": [], "procurement": "pending"}, history=[]
    )
    service = SimpleNamespace(context_for=AsyncMock(return_value=context))
    gateway = AgentGateway(
        Settings(_env_file=None, agent_mode="mock", max_model_calls=1), service, load_story()
    )
    try:
        assert gateway.model_factory() is gateway.model_factory()
        # More turns than the per-turn physical-call limit must still succeed.
        for _ in range(3):
            usage = {}
            assert "".join([s async for s in gateway.run_agent(turn(), InMemorySaver(), usage)])
            assert usage["model_calls"] == 1
    finally:
        await gateway.close()


async def test_exact_work_request_uses_authoritative_rules_without_model():
    context = AgentContext(
        story_version=3, facts={"act": 2, "flags": [], "procurement": "pending"}, history=[]
    )
    service = SimpleNamespace(
        context_for=AsyncMock(return_value=context),
        npc_operation=AsyncMock(return_value="公开材料要求已记录。"),
    )
    model_factory = Mock(side_effect=AssertionError("must not call a model"))
    gateway = AgentGateway(
        Settings(_env_file=None, agent_mode="mock"), service, load_story(), model_factory
    )
    parts = [p async for p in gateway.run_agent(turn("采购需要哪些材料"), InMemorySaver(), {})]
    assert parts == ["公开材料要求已记录。"]
    service.npc_operation.assert_awaited_once_with("turn", "sun", "request_materials")


@pytest.mark.parametrize(
    "text", ["你好", "你刚刚那句话具体是什么意思？", "我的穿着和工作能力有什么关系？请就事论事。"]
)
async def test_v3_dialogue_has_one_model_call_and_cannot_issue_extra_tools(text):
    import json

    import httpx
    from langchain_deepseek import ChatDeepSeek

    requests = []

    async def transport(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert not payload.get("tools")
        return httpx.Response(
            200,
            json={
                "id": "reply",
                "object": "chat.completion",
                "created": 1,
                "model": "deepseek-flash",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "我们先把眼前的事说清楚。"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
            },
        )

    context = AgentContext(
        story_version=3, facts={"act": 1, "flags": [], "procurement": "pending"}, history=[]
    )
    service = SimpleNamespace(context_for=AsyncMock(return_value=context))
    model = ChatDeepSeek(
        model="deepseek-flash",
        api_key="fixture",
        http_async_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
        max_retries=0,
    )
    gateway = AgentGateway(
        Settings(_env_file=None, agent_mode="mock"), service, load_story(), lambda: model
    )
    usage = {}
    assert (
        "".join([p async for p in gateway.run_agent(turn(text), InMemorySaver(), usage)])
        == "我们先把眼前的事说清楚。"
    )
    assert len(requests) == usage["model_calls"] == 1
    assert "传统化工国企" in requests[0]["messages"][0]["content"]
