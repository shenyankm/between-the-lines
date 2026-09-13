from .game_types import GameState, VisibleState
from .story import load_story

NPCS = {"sun", "li", "zhang"}


class RuleError(ValueError):
    pass


def initial_state() -> GameState:
    return GameState(
        act=0, credit=50, stress=25, heat=10, flags=[], procurement="pending", ending=None
    )


def apply_player(state: GameState, action: str) -> tuple[GameState, str]:
    s = state.model_copy(deep=True)
    flags = set(s.flags)
    if action == "epilogue":
        if not s.ending:
            raise RuleError("故事尚未结束。")
        return s, "正在整理这段故事。"
    if s.ending:
        raise RuleError("这局故事已结束，请新建存档。")
    if action == "speak":
        if s.act == 0:
            raise RuleError("请先进入故事。")
        return s, ""
    # Track authored transitions explicitly so an early departure cannot imply
    # a later private event. Old completed saves returned above stay untouched.
    flags.add("relationship_story")
    if s.act >= 2:
        flags.add("reflection")
    if s.act >= 3:
        flags.add("personal_resolved")
    s.flags = sorted(flags)
    if action == "leave":
        s.act, s.ending = 4, "主动离开"
        return s, "你选择离开当前环境，为下一段职业生活留出空间。"
    if action in {"cut_ties", "keep_distance"}:
        if s.act != 3 or not {"clarified", "delivered"} <= flags:
            raise RuleError("请先在第三幕完成澄清与实验结果交付，再决定私人关系。")
        if flags & {"sun_cut", "sun_observe"}:
            raise RuleError("关系选择已经记录，请继续故事。")
        flags.add("sun_cut" if action == "cut_ties" else "sun_observe")
        s.flags = sorted(flags)
        return s, load_story().relationship_actions[action]
    rules: dict[str, tuple[int, str, int, int, int, str]] = {
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
        if s.act == 1 and flags.intersection({"wang_contacted", "boundary", "confronted"}):
            s.act = 2
            flags.add("reflection")
        elif s.act == 2 and s.procurement == "approved":
            s.act = 3
            flags.add("personal_resolved")
        elif s.act == 3 and {"clarified", "delivered"} <= flags:
            if not flags & {"sun_cut", "sun_observe"}:
                raise RuleError("请先选择如何处理与孙淼的私人关系。")
            s.act = 4
            s.ending = "找回自我 · 只留工作往来" if "sun_cut" in flags else "保持距离 · 继续观察"
        else:
            raise RuleError("还有关键事项未完成，请查看工作系统。")
        s.flags = sorted(flags)
        return s, ""
    if action not in rules:
        raise RuleError("未知操作。")
    act, flag, credit, stress, heat, text = rules[action]
    if s.act != act:
        raise RuleError("当前幕次无法执行这个操作。")
    if flag in flags:
        raise RuleError("这项操作已经完成。")
    if action == "supplement" and "requirements" not in flags:
        raise RuleError("请先向财务确认缺少的材料。")
    flags.add(flag)
    s.flags = sorted(flags)
    for key, delta in (("credit", credit), ("stress", stress), ("heat", heat)):
        setattr(s, key, max(0, min(100, getattr(s, key) + delta)))
    if action == "begin":
        s.act = 1
    return s, text


def apply_npc(state: GameState, npc: str, operation: str) -> tuple[GameState, str]:
    s = state.model_copy(deep=True)
    if npc not in NPCS or s.act != 2 or s.ending:
        raise RuleError("角色或幕次不允许此操作。")
    flags = set(s.flags)
    if operation == "request_materials" and npc in {"sun", "li"}:
        flags.add("requirements")
        text = "财务已明确要求：报价单、用途说明、加急依据。"
    elif operation == "approve_purchase" and npc == "li":
        if "materials" not in flags:
            raise RuleError("材料尚未补齐，不能通过审核。")
        s.procurement = "approved"
        text = "李姐确认材料齐全，采购审核通过。"
    elif operation == "support_project" and npc == "zhang":
        if "reported" not in flags:
            raise RuleError("尚未收到项目进度汇报。")
        flags.add("supported")
        text = "张工已了解进度风险，并明确支持跟进。"
    else:
        raise RuleError("该角色没有这项权限。")
    s.flags = sorted(flags)
    return s, text


def visible_state(state: GameState, npc: str) -> VisibleState:
    if npc == "wang":
        return {"act": state.act, "procurement": "pending", "flags": []}
    visible = {"requirements", "materials", "started", "clarified", "delivered", "confronted"}
    if npc == "zhang":
        visible |= {"reported", "supported"}
    if npc == "sun":
        visible |= {"boundary", "sun_cut", "sun_observe"}
    return {
        "act": state.act,
        "procurement": state.procurement,
        "flags": [f for f in state.flags if f in visible],
    }
