import json
from types import SimpleNamespace

import httpx
import pytest
from langchain_deepseek import ChatDeepSeek
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver

from app import agents
from app.config import Settings
from app.context import AgentContext
from app.story import load_story

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("provider", ["deepseek", "openai"])
@pytest.mark.parametrize("tool_name", ["act_on_work", "execute", "task"])
async def test_deep_agent_tool_loop_isolation_and_fixed_model(monkeypatch, tool_name, provider):
    requests, operations = [], []
    expected_model = "gpt-4.1-mini" if provider == "openai" else "deepseek-flash"

    async def transport(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert payload["model"] == expected_model
        if provider == "deepseek":
            assert payload["thinking"] == {"type": "disabled"}
        else:
            assert "thinking" not in payload
        assert {t["function"]["name"] for t in payload["tools"]} == {
            "inspect_work",
            "act_on_work",
            "propose_action",
            "remember_player",
        }
        if len(requests) == 1:
            content = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": json.dumps(
                                {"operation": "request_materials"}
                                if tool_name == "act_on_work"
                                else {"command": "echo forbidden"}
                            ),
                        },
                    }
                ],
            }
            reason = "tool_calls"
        else:
            content = {"role": "assistant", "content": "请补充报价单和用途说明。"}
            reason = "stop"
        return httpx.Response(
            200,
            json={
                "id": f"chat_{len(requests)}",
                "object": "chat.completion",
                "created": 1,
                "model": "deepseek-flash",
                "choices": [{"index": 0, "message": content, "finish_reason": reason}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
            },
        )

    async def context(turn):
        return AgentContext.model_validate(
            {
                "facts": {"act": 2, "procurement": "pending", "flags": []},
                "history": [{"kind": "player", "text": "需要哪些材料？", "npc": "sun"}],
            }
        )

    async def operation(turn_id, npc, op):
        operations.append((turn_id, npc, op))
        return "材料要求已记录。"

    settings = Settings(_env_file=None, agent_mode="mock")
    monkeypatch.setattr(settings, "agent_mode", provider)
    gateway = agents.AgentGateway(
        settings, SimpleNamespace(context_for=context, npc_operation=operation), load_story()
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        model = (ChatOpenAI if provider == "openai" else ChatDeepSeek)(
            # This fixture returns non-stream JSON; production streaming has its own test.
            disable_streaming=True,
            model=expected_model,
            api_key="fixture-not-a-secret",
            http_async_client=http,
            max_retries=0,
            extra_body={"thinking": {"type": "disabled"}} if provider == "deepseek" else {},
        )
        gateway.model_factory = lambda: model
        turn = SimpleNamespace(id="t", user_id="u", save_id="s", input=SimpleNamespace(npc="sun"))
        usage = {}
        replies = [reply async for reply in gateway.run_agent(turn, InMemorySaver(), usage)]
    assert replies == ["请补充报价单和用途说明。"]
    context_payload = json.loads(requests[0]["messages"][-1]["content"])
    assert context_payload["当前场景"]["地点"] == "财务窗口"
    assert "催化剂" in requests[0]["messages"][0]["content"]
    assert "项目例会" not in context_payload["当前场景"]["角色处境"]
    assert "床" not in context_payload["当前场景"]["角色处境"]
    assert len(requests) == 2
    assert usage["input_tokens"] == 40
    assert operations == ([("t", "sun", "request_materials")] if tool_name == "act_on_work" else [])
    assert any(m["role"] == "tool" for m in requests[1]["messages"])


def test_model_factory_has_no_other_provider(monkeypatch):
    model = agents.make_model(
        Settings(_env_file=None, agent_mode="mock", deepseek_api_key="fixture-not-a-secret")
    )
    assert model.model_name == "deepseek-flash"
    assert model.extra_body["thinking"]["type"] == "disabled"
    assert model.max_retries == 0


async def test_openai_factory_can_run_successive_turns_after_client_cleanup(monkeypatch):
    payloads = []

    def respond(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "chat_fixture",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-4.1-mini",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "收到。"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
            },
        )

    class SyncFixture(httpx.Client):
        def __init__(self):
            super().__init__(transport=httpx.MockTransport(respond))

    class AsyncFixture(httpx.AsyncClient):
        def __init__(self):
            super().__init__(transport=httpx.MockTransport(respond))

    monkeypatch.setattr(httpx, "Client", SyncFixture)
    monkeypatch.setattr(httpx, "AsyncClient", AsyncFixture)
    settings = Settings(
        _env_file=None,
        agent_mode="openai",
        openai_api_key="fixture",
        openai_base_url="https://gateway.example/v1",
    )
    for _ in range(2):
        model = agents.make_model(settings)
        try:
            response = await model.ainvoke("你好", stream=False)
            assert response.content == "收到。"
        finally:
            await model.root_async_client.close()
            model.root_client.close()
    assert len(payloads) == 2
    assert all(p["model"] == "gpt-4.1-mini" and "thinking" not in p for p in payloads)


def test_private_scene_notes_are_not_in_public_story():
    story = load_story()
    public = story.public().model_dump_json()
    assert "scene_notes" not in public
    assert "world" not in story.public().model_dump()
    assert story.npcs["sun"].scene_notes["1"] not in public


async def test_epilogue_uses_narrative_facts_and_responses_text_blocks():
    from unittest.mock import AsyncMock, Mock

    model = SimpleNamespace(
        ainvoke=AsyncMock(
            return_value=SimpleNamespace(
                content=[{"type": "text", "text": "你守住了边界。"}], usage_metadata={}
            )
        ),
        root_async_client=SimpleNamespace(close=AsyncMock()),
        root_client=SimpleNamespace(close=Mock()),
    )
    gateway = agents.AgentGateway(
        Settings(_env_file=None, agent_mode="openai"),
        SimpleNamespace(),
        load_story(),
        model_factory=lambda: model,
    )
    text = await gateway.run_epilogue(
        {
            "act": 4,
            "credit": 90,
            "stress": 0,
            "heat": 10,
            "flags": ["boundary", "materials"],
            "procurement": "approved",
            "ending": "保持职业关系和边界",
        },
        {},
    )
    assert text == "你守住了边界。"
    prompt = model.ainvoke.call_args.args[0][-1][1]
    assert "90" not in prompt and "credit" not in prompt and "stress" not in prompt
    assert "你补齐了报价单" in prompt


async def test_streams_only_explicit_final_answer_before_completion():
    from unittest.mock import AsyncMock, Mock

    from langchain_core.messages import AIMessage, AIMessageChunk

    async def context(turn):
        return AgentContext(facts={"act": 1, "flags": [], "procurement": "pending"}, history=[])

    reached_end = False

    async def updates(*args, **kwargs):
        nonlocal reached_end
        assert kwargs["stream_mode"] == ["updates", "messages"]
        for content in [
            [{"type": "text", "text": "UNCLASSIFIED", "index": 0}],
            [{"type": "reasoning", "text": "PRIVATE_REASONING", "index": 1}],
            [{"type": "text", "phase": "commentary", "text": "TOOL_PLANNING", "index": 2}],
            [{"type": "text", "phase": "final_answer", "text": "", "index": 3}],
            [{"type": "text", "text": "你好，", "index": 3}],
            [{"type": "text", "text": "周凌。", "index": 3}],
        ]:
            yield "messages", (AIMessageChunk(id="stream-1", content=content), {})
        reached_end = True
        yield (
            "updates",
            {
                "model": {
                    "messages": [
                        AIMessage(
                            content="你好，周凌。",
                            usage_metadata={
                                "input_tokens": 5,
                                "output_tokens": 5,
                                "total_tokens": 10,
                            },
                        )
                    ]
                }
            },
        )

    model = SimpleNamespace(
        root_async_client=SimpleNamespace(close=AsyncMock()),
        root_client=SimpleNamespace(close=Mock()),
    )
    gateway = agents.AgentGateway(
        Settings(_env_file=None, agent_mode="mock"),
        SimpleNamespace(context_for=context),
        load_story(),
        model_factory=lambda: model,
    )
    gateway.build_agent = lambda *args, **kwargs: SimpleNamespace(astream=updates)
    turn = SimpleNamespace(
        id="t", user_id="u", save_id="s", input=SimpleNamespace(npc="sun", action="speak")
    )
    usage = {}
    stream = gateway.run_agent(turn, InMemorySaver(), usage)
    assert await anext(stream) == "你好，"
    assert not reached_end
    assert [chunk async for chunk in stream] == ["周凌。"]
    assert reached_end and usage["model_calls"] == 1
