"""Deterministic DeepSeek-compatible transport for development and offline tests.

Requests still pass through ChatDeepSeek, Deep Agents, domain tools, and checkpoints.
No requests leave the process. This is a fixture, not a model quality evaluation.
"""

import asyncio
import json
from typing import Any

import httpx


def completion(payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload["messages"]
    human = next(m for m in reversed(messages) if m["role"] == "user")
    context = json.loads(human["content"])
    if "结局事实" in context:
        state = context["结局事实"]
        flags = state["flags"]
        text = "你为这段经历选择了“" + state["ending"] + "”。"
        if "materials" in flags:
            text += "你把模糊的阻碍拆成了可以核对的材料，让工作重新向前。"
        if "boundary" in flags:
            text += "你也认真说出了自己的边界，让职业合作有了更清楚的位置。"
        if state["ending"] == "主动离开":
            text += "离开不是对能力的否定，而是给自己选择下一种环境的机会。"
        text += "下一次面对言外之意，你已经拥有更多回应的方式。"
        return {"role": "assistant", "content": text}
    facts = context["最新可见事实"]
    history = context["可见对话"]
    system = str(messages[0]["content"])
    npc = "sun" if "你是孙淼" in system else "li" if "你是李姐" in system else "zhang"
    last_text = history[-1].get("text", "") if history else ""
    flags = facts["flags"]
    tool_result = messages[-1]["content"] if messages[-1]["role"] == "tool" else None
    if context.get("当前回合类型") == "行动回应":
        action = history[-1].get("action", "") if history else ""
        responses = {
            "boundary": "好，以后我直接跟你说事情，不替你定义情绪。",
            "public_confront": "你一定要当着大家这样问吗？采购的事以后我们按记录说清楚。",
            "repair": "当时我也下不来台。既然说开了，工作我们直接沟通，材料还是照流程交。",
            "written_record": "记录我收到了。材料齐全后你再发起审核，我会按书面依据核对。",
            "supplement": "材料收到了。你可以现在向我发起审核，我会核对后给出结果。",
            "report": "风险我知道了。你需要我协调实验排期的话，直接说，我来落实支持。",
            "clarify": "这件事在例会上说清了。接下来我们看项目结果。",
            "document_rumor": "证据先留好，我私下核实。这之前，例会上先不扩大讨论。",
            "deliver": "结果与计划收到了。后续按这个安排走，有变动及时同步。",
        }
        return {"role": "assistant", "content": responses.get(action, "收到，我们继续。")}
    operation = None
    if facts["act"] == 2 and not tool_result:
        if npc in {"sun", "li"} and "requirements" not in flags:
            operation = "request_materials"
        elif npc == "li" and "materials" in flags and facts["procurement"] != "approved":
            operation = "approve_purchase"
        elif npc == "zhang" and "reported" in flags and "supported" not in flags:
            operation = "support_project"
    if not tool_result and not operation:
        desired = next(
            (
                a
                for word, a in (
                    ("不要替我定义", "boundary"),
                    ("当众质问", "public_confront"),
                    ("私下修复", "repair"),
                    ("补齐采购", "supplement"),
                    ("保留证据", "document_rumor"),
                )
                if word in last_text and a in context.get("可确认行动", {})
            ),
            None,
        )
        if desired:
            return {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_proposal",
                        "type": "function",
                        "function": {
                            "name": "propose_action",
                            "arguments": json.dumps({"action": desired}),
                        },
                    }
                ],
            }
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
    if tool_result:
        reply = str(tool_result)
    elif facts["act"] == 2:
        reply = {
            "sun": "报价单、用途说明和加急依据都写清楚。材料在系统里提交，大家按流程来。",
            "li": "我先核对材料。请把缺少的说明补进采购单，齐全后我来审核。",
            "zhang": "把已完成的工作、当前阻碍和预计延迟发给我，我看过后一起推进。",
        }[npc]
    elif facts["act"] == 3:
        reply = {
            "sun": "我也只是听别人提起。既然你说没有这回事，那就把项目做好吧。",
            "li": "传言不是事实，还是看正式汇报。需要核对采购记录，我可以配合。",
            "zhang": "去留由你自己决定，例会先看实验结果。把事实讲清楚，接着汇报。",
        }[npc]
    elif any(word in last_text for word in ("边界", "生气", "玩笑", "尊重")):
        reply = {
            "sun": "好，我知道了。以后有事情我直接跟你说，不替你下结论。",
            "li": "你说清楚就好。同事之间有事情直接沟通，不必让玩笑变了味。",
            "zhang": "把你的想法说清楚是对的。工作上的事照常推进，有困难及时同步。",
        }[npc]
    else:
        reply = {
            "sun": "那天是财务几个人的小聚，我以为有人告诉你了。你现在提起，我们就把这件事说开吧。",
            "li": "王会计收到你的祝福会高兴的。聚会的事可以再问问负责通知的人。",
            "zhang": "我听着。先说具体发生了什么，再说你准备怎么处理。",
        }[npc]
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
