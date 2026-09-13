"""Deterministic DeepSeek-compatible transport for development and offline tests.

Requests still pass through ChatDeepSeek, Deep Agents, domain tools, and checkpoints.
No requests leave the process. This is a fixture, not a model quality evaluation.
"""

import asyncio
import json
from typing import Any

import httpx

from .game_types import Npc
from .story import load_story


def completion(payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload["messages"]
    human = next(m for m in reversed(messages) if m["role"] == "user")
    context = json.loads(human["content"])
    if "结局事实" in context:
        state = context["结局事实"]
        text = "你为这段经历选择了“" + state["ending"] + "”。"
        text += state.get("关系总结") or "下一次面对言外之意，你已经拥有更多回应的方式。"
        return {"role": "assistant", "content": text}
    facts = context["最新可见事实"]
    system = str(messages[0]["content"])
    npc: Npc = "sun" if "你是孙淼" in system else "li" if "你是李姐" in system else "zhang"
    flags = facts["flags"]
    tool_result = messages[-1]["content"] if messages[-1]["role"] == "tool" else None
    operation = None
    if facts["act"] == 2 and not tool_result:
        if npc in {"sun", "li"} and "requirements" not in flags:
            operation = "request_materials"
        elif npc == "li" and "materials" in flags and facts["procurement"] != "approved":
            operation = "approve_purchase"
        elif npc == "zhang" and "reported" in flags and "supported" not in flags:
            operation = "support_project"
    if operation:
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_work",
                    "type": "function",
                    "function": {
                        "name": "act_on_work",
                        "arguments": json.dumps({"operation": operation}),
                    },
                }
            ],
        }
    reply = str(tool_result) if tool_result else load_story().greeting_for(npc, facts["act"], flags)
    return {"role": "assistant", "content": reply}


async def handle_request(request: httpx.Request) -> httpx.Response:
    payload = json.loads(request.content)
    await asyncio.sleep(0.03)
    message = completion(payload)
    base = {
        "id": "fixture_completion",
        "object": "chat.completion",
        "created": 1,
        "model": "deepseek-flash",
    }
    usage = {
        "prompt_tokens": max(1, len(request.content) // 4),
        "completion_tokens": max(1, len(json.dumps(message, ensure_ascii=False)) // 2),
    }
    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
    reason = "tool_calls" if message.get("tool_calls") else "stop"
    if not payload.get("stream"):
        return httpx.Response(
            200,
            json={
                **base,
                "choices": [{"index": 0, "message": message, "finish_reason": reason}],
                "usage": usage,
            },
        )
    deltas: list[dict[str, Any]] = [{"role": "assistant", "content": ""}]
    if message.get("tool_calls"):
        call = message["tool_calls"][0]
        args = call["function"]["arguments"]
        midpoint = len(args) // 2
        deltas += [
            {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": call["id"],
                        "type": "function",
                        "function": {
                            "name": call["function"]["name"],
                            "arguments": args[:midpoint],
                        },
                    }
                ]
            },
            {"tool_calls": [{"index": 0, "function": {"arguments": args[midpoint:]}}]},
        ]
    else:
        reply = message["content"]
        deltas += [{"content": reply[i : i + 8]} for i in range(0, len(reply), 8)]
    chunks = [
        {
            **base,
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        }
        for delta in deltas
    ]
    chunks.append(
        {
            **base,
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {}, "finish_reason": reason}],
        }
    )
    chunks.append({**base, "object": "chat.completion.chunk", "choices": [], "usage": usage})
    body = (
        "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)
        + "data: [DONE]\n\n"
    )
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())
