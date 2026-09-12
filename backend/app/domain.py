import json
from copy import deepcopy
from pathlib import Path
from typing import Any

STORY: dict[str, Any] = json.loads(Path(__file__).with_name("story.json").read_text())
NPCS = set(STORY["npcs"])


class RuleError(ValueError):
    pass


def initial_state() -> dict[str, Any]:
    return {
        "act": 0,
        "credit": 50,
        "stress": 25,
        "heat": 10,
        "flags": [],
        "procurement": "pending",
        "ending": None,
    }


def apply_player(state: dict[str, Any], action: str) -> tuple[dict[str, Any], str]:
    s = deepcopy(state)
    flags = set(s["flags"])
    if action == "epilogue":
        if not s["ending"]:
            raise RuleError("故事尚未结束。")
        return s, "正在整理这段故事。"
    if s["ending"]:
        raise RuleError("这局故事已结束，请新建存档。")
    if action == "speak":
        if s["act"] == 0:
            raise RuleError("请先进入故事。")
        return s, ""
    if action == "leave":
        s.update(act=4, ending="主动离开")
        return s, "你选择离开当前环境，为下一段职业生活留出空间。"
    rules = {
        "begin": (0, "started", 0, 0, 0, "你决定先弄清发生了什么。"),
        "contact_wang": (1, "wang_contacted", 5, -5, 0, "你向王会计发送了祝福，说明遗憾未能到场。"),
        "boundary": (1, "boundary", 5, -5, 0, "你明确表达：可以讨论事情，请不要替我定义情绪。"),
        "public_confront": (1, "confronted", -5, 10, 25, "你当众质问孙淼，周围同事开始关注冲突。"),
        "supplement": (
            2,
            "materials",
            10,
            -5,
            0,
            "你补齐报价、用途说明与加急依据，重新提交采购材料。",
        ),
        "report": (2, "reported", 10, -5, 0, "你向张工同步了阻碍、补充材料与预计延迟。"),
        "clarify": (3, "clarified", 5, -5, -5, "你在例会上澄清跳槽传言，把讨论带回项目事实。"),
        "deliver": (3, "delivered", 10, -5, -5, "你提交了实验结果和下一阶段计划。"),
    }
    if action == "next":
        if s["act"] == 1 and flags.intersection({"wang_contacted", "boundary", "confronted"}):
            s["act"] = 2
        elif s["act"] == 2 and s["procurement"] == "approved":
            s["act"] = 3
        elif s["act"] == 3 and {"clarified", "delivered"} <= flags:
            s["act"] = 4
            s["ending"] = (
                "撕破脸"
                if "confronted" in flags
                else "保持职业关系和边界"
                if "boundary" in flags
                else "关系重新协商"
            )
        else:
            raise RuleError("还有关键事项未完成，请查看工作系统。")
        return s, STORY["acts"][s["act"]]["intro"]
    if action not in rules:
        raise RuleError("未知操作。")
    act, flag, credit, stress, heat, text = rules[action]
    if s["act"] != act:
        raise RuleError("当前幕次无法执行这个操作。")
    if flag in flags:
        raise RuleError("这项操作已经完成。")
    if action == "supplement" and "requirements" not in flags:
        raise RuleError("请先向财务确认缺少的材料。")
    flags.add(flag)
    s["flags"] = sorted(flags)
    for key, delta in (("credit", credit), ("stress", stress), ("heat", heat)):
        s[key] = max(0, min(100, s[key] + delta))
    if action == "begin":
        s["act"] = 1
    return s, text


def apply_npc(state: dict[str, Any], npc: str, operation: str) -> tuple[dict[str, Any], str]:
    s = deepcopy(state)
    if npc not in NPCS or s["act"] != 2 or s["ending"]:
        raise RuleError("角色或幕次不允许此操作。")
    flags = set(s["flags"])
    if operation == "request_materials" and npc in {"sun", "li"}:
        flags.add("requirements")
        text = "财务已明确要求：报价单、用途说明、加急依据。"
    elif operation == "approve_purchase" and npc == "li":
        if "materials" not in flags:
            raise RuleError("材料尚未补齐，不能通过审核。")
        s["procurement"] = "approved"
        text = "李姐确认材料齐全，采购审核通过。"
    elif operation == "support_project" and npc == "zhang":
        if "reported" not in flags:
            raise RuleError("尚未收到项目进度汇报。")
        flags.add("supported")
        text = "张工已了解进度风险，并明确支持跟进。"
    else:
        raise RuleError("该角色没有这项权限。")
    s["flags"] = sorted(flags)
    return s, text


def visible_state(state: dict[str, Any], npc: str) -> dict[str, Any]:
    visible = {"requirements", "materials", "started", "clarified", "delivered", "confronted"}
    if npc == "zhang":
        visible |= {"reported", "supported"}
    if npc == "sun":
        visible.add("boundary")
    return {
        "act": state["act"],
        "procurement": state["procurement"],
        "flags": [f for f in state["flags"] if f in visible],
    }
