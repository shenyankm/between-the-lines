import json
from types import SimpleNamespace

import httpx
import pytest
from langchain_deepseek import ChatDeepSeek
from langgraph.checkpoint.memory import InMemorySaver

from app import agents
from app.config import Settings
from app.context import AgentContext
from app.story import load_story

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("tool_name", ["act_on_work", "execute", "task"])
async def test_deep_agent_tool_loop_isolation_and_fixed_model(monkeypatch, tool_name):
    requests, operations = [], []

    async def transport(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert payload["model"] == "deepseek-flash"
        assert payload["thinking"] == {"type": "disabled"}
        assert not {"task", "execute"} & {t["function"]["name"] for t in payload["tools"]}
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
    monkeypatch.setattr(settings, "agent_mode", "deepseek")
    gateway = agents.AgentGateway(
        settings, SimpleNamespace(context_for=context, npc_operation=operation), load_story()
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        model = ChatDeepSeek(
            model="deepseek-flash",
            api_key="fixture-not-a-secret",
            http_async_client=http,
            max_retries=0,
            extra_body={"thinking": {"type": "disabled"}},
        )
        gateway.model_factory = lambda: model
        turn = SimpleNamespace(id="t", user_id="u", save_id="s", input=SimpleNamespace(npc="sun"))
        usage = {}
        replies = [reply async for reply in gateway.run_agent(turn, InMemorySaver(), usage)]
    assert replies == ["请补充报价单和用途说明。"]
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
