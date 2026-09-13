from . import investigation
from .game_types import GameState, VisibleState

NPCS = {"sun", "li", "zhang"}

ACTION_TARGETS = {
    "boundary": "sun",
    "public_confront": "sun",
    "repair": "sun",
    "supplement": "li",
    "written_record": "li",
    "report": "zhang",
    "clarify": "zhang",
    "document_rumor": "zhang",
    "deliver": "zhang",
}
ACTION_LABELS = {
    "contact_wang": "私下给王会计发送祝福",
    "boundary": "向孙淼明确表达边界",
    "public_confront": "当众质问孙淼",
    "supplement": "补齐采购材料",
    "report": "向张工同步项目风险",
    "clarify": "在例会上公开澄清传言",
    "deliver": "提交实验结果与计划",
    "repair": "私下修复与孙淼的沟通",
    "written_record": "向财务提交书面沟通记录",
    "document_rumor": "保留传言证据，请张工私下核实",
}


ACTION_TARGETS.update(investigation.TARGETS)
ACTION_LABELS.update({a: v[1] for a, v in investigation.RULES.items()})


def available_actions(state: GameState) -> dict[str, str]:
    result = {}
    for action, label in ACTION_LABELS.items():
        try:
            apply_player(state, action)
        except RuleError:
            continue
        result[action] = label
    return result


class RuleError(ValueError):
    pass


def initial_state() -> GameState:
    return GameState(
        act=0, credit=50, stress=25, heat=10, flags=[], procurement="pending", ending=None
    )


def _apply_player(state: GameState, action: str) -> tuple[GameState, str]:
    s = state.model_copy(deep=True)
    flags = set(s.flags)
    if action == "epilogue":
        if not s.ending:
            raise RuleError("故事尚未结束。")
        return s, "正在整理这段故事。"
    if s.ending:
        raise RuleError("这局故事已结束，请新建存档。")
    if action in investigation.RULES:
        return investigation.apply(s, action)
    if action == "speak":
        if s.act == 0:
            raise RuleError("请先进入故事。")
        return s, ""
    if action == "leave":
        s.act, s.ending = 4, "主动离开"
        return s, "你选择离开当前环境，为下一段职业生活留出空间。"
    rules: dict[str, tuple[int, str, int, int, int, str]] = {
        "repair": (
            2,
            "repaired",
            0,
            -5,
            -10,
            "你私下向孙淼说明：收回当众质问的方式，但保留对直接沟通的要求。",
        ),
        "written_record": (
            2,
            "written_record",
            5,
            5,
            0,
            "你把采购往来整理成书面记录，交给财务核对；双方以后按记录沟通。",
        ),
        "document_rumor": (
            3,
            "rumor_documented",
            0,
            5,
            -10,
            "你保存了传言的原话与时间，请张工私下核实，暂不在例会上公开澄清。",
        ),
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
        if "company_review" in flags and "attend_review" not in flags:
            raise RuleError("请先参加公司协调，提交事实记录。")
        if s.stress >= 80:
            raise RuleError("内耗过高，请先休整，或选择离开。")
        if s.act == 1 and flags.intersection({"wang_contacted", "boundary", "confronted"}):
            s.act = 2
            if "confronted" in flags:
                s.consequences.append(
                    "上次的公开冲突让孙淼提高戒心；仍可通过李姐核对书面记录，采购审核不以你道歉为条件。"
                )
        elif s.act == 2 and s.procurement == "approved":
            s.act = 3
            if "supported" in flags:
                flags.add("schedule_protected")
                s.consequences.append("提前同步风险获得了研发支持，实验排期得到保留。")
            else:
                flags.add("schedule_delayed")
                s.stress = min(100, s.stress + 10)
                s.consequences.append(
                    "采购通过了，但此前没有落实研发支持，原实验窗口已被占用；提交结果时需要说明延期并调整计划。"
                )
            s.flags = sorted(flags)
        elif (
            s.act == 3
            and "delivered" in flags
            and flags.intersection(
                {"clarified", "rumor_documented", "resolve_rumor", "publish_rumor"}
            )
        ):
            s.act = 4
            s.ending = (
                "公开事实，守住边界"
                if "publish_rumor" in flags
                else "克制纠偏，保留记录"
                if "resolve_rumor" in flags
                else "克制留痕，关系待定"
                if "rumor_documented" in flags
                else "修复沟通，保留边界"
                if {"confronted", "repaired"} <= flags
                else "撕破脸"
                if "confronted" in flags
                else "保持职业关系和边界"
                if "boundary" in flags
                else "关系重新协商"
            )
        else:
            raise RuleError("还有关键事项未完成，请查看工作系统。")
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
    if action in {"repair", "written_record"} and "confronted" not in flags:
        raise RuleError("当前没有需要处理的公开冲突。")
    if (action == "repair" and "written_record" in flags) or (
        action == "written_record" and "repaired" in flags
    ):
        raise RuleError("你已选择另一种处理冲突的方式。")
    if action in {"clarify", "document_rumor"} and flags.intersection(
        {"resolve_rumor", "publish_rumor"}
    ):
        raise RuleError("你已选择另一种处理传言的方式。")
    if (action == "clarify" and "rumor_documented" in flags) or (
        action == "document_rumor" and "clarified" in flags
    ):
        raise RuleError("你已选择另一种处理传言的方式。")
    if action == "repair":
        s.consequences.append(
            "孙淼表面接受直接沟通，却仍用玩笑试探；你调整的是沟通方式，并未收回边界。采购按材料审核。"
        )
    if action == "written_record":
        s.consequences.append("书面记录补上了审核依据，财务合作恢复；你与孙淼的关系仍然疏远。")
    if action == "document_rumor":
        s.consequences.append(
            "张工会私下核实传言；由于没有公开澄清，同事间的猜测暂时仍在，关系留待后续观察。"
        )
    if action == "deliver" and "schedule_delayed" in flags:
        text = "你提交了已有实验结果，说明错过实验窗口的原因，并附上调整后的下一阶段计划。"
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
    visible = {
        "requirements",
        "materials",
        "started",
        "clarified",
        "delivered",
        "confronted",
        "written_record",
        "repaired",
        "schedule_delayed",
        "schedule_protected",
    }
    if npc == "zhang":
        visible |= {"reported", "supported", "rumor_documented"}
    if npc == "sun":
        visible.add("boundary")
    return {
        "act": state.act,
        "procurement": state.procurement,
        "flags": [f for f in state.flags if f in visible],
    }


def apply_player(state: GameState, action: str) -> tuple[GameState, str]:
    s, text = _apply_player(state, action)
    changes = {
        "boundary": ("sun", 5),
        "public_confront": ("sun", -15),
        "report": ("zhang", 15),
        "supplement": ("li", 10),
        "deliver": ("zhang", 10),
    }
    if action in changes:
        npc, delta = changes[action]
        setattr(s.trust, npc, max(0, min(100, getattr(s.trust, npc) + delta)))
    if not s.ending and action not in {"speak", "epilogue"}:
        investigation.thresholds(s)
    return s, text
