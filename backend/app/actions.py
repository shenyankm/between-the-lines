"""Finite action catalogue shared by buttons, prompts and domain validation."""

from typing import Any

from pydantic import BaseModel

from .domain import RuleError, apply_npc, apply_player
from .game_types import Action, GameState, GameStateV2, GameStateV3, Npc

MAJOR = {
    "public_confront",
    "cut_ties",
    "keep_distance",
    "partner_breakup",
    "partner_distance",
    "leave",
}
PRIVATE = {"contact_wang", "partner_breakup", "partner_distance"}
WORK = {"request_materials", "approve_purchase", "support_project", "joint_review"}


class AvailableAction(BaseModel):
    action: Action
    label: str
    target: Npc | None = None
    enabled: bool = True
    completed: bool = False
    requires_confirmation: bool = False
    reason: str = ""
    effect: str = ""


# label, acts, target, completion flag, explanation
CATALOG: dict[str, tuple[str, set[int], Npc | None, str, str]] = {
    "begin": ("进入故事", {0}, None, "started", "开始这段经历"),
    "contact_wang": (
        "私信祝福王会计",
        {1},
        None,
        "wang_contacted",
        "保留与前辈的私人联系；信用 +5，心绪消耗 -5",
    ),
    "boundary": (
        "明确表达我的边界",
        {1},
        "sun",
        "boundary",
        "孙淼将转向工作沟通；信用 +5，心绪消耗 -5",
    ),
    "public_confront": (
        "当众质问孙淼",
        {1},
        "sun",
        "confronted",
        "同事会关注争议，后续可核对记录；信用 -5，心绪消耗 +10",
    ),
    "verify_notice": (
        "核对通知记录",
        {1, 2},
        "li",
        "notice_checked",
        "只记录能核实的信息，不推断是谁故意遗漏通知",
    ),
    "request_materials": (
        "询问材料要求",
        {2},
        "sun",
        "requirements",
        "登记报价、用途与加急依据三项要求",
    ),
    "supplement": ("补齐采购材料", {2}, None, "materials", "提交完整材料；信用 +10，心绪消耗 -5"),
    "report": ("向张工同步进度", {2}, "zhang", "reported", "同步项目风险；信用 +10，心绪消耗 -5"),
    "support_project": (
        "请求张工支持",
        {2},
        "zhang",
        "supported",
        "获得实际项目支持并开放联合沟通",
    ),
    "approve_purchase": ("请求李姐审核", {2}, "li", "purchase_approved", "李姐核对完整材料后审核"),
    "joint_review": (
        "申请联合沟通",
        {2},
        "li",
        "joint_review",
        "张工协调项目风险，李姐负责最终审核",
    ),
    "partner_breakup": (
        "结束与谢川的关系",
        {2},
        None,
        "partner_breakup",
        "明确提出分手，不再继续这段伴侣关系",
    ),
    "partner_distance": (
        "明确边界，暂时保持距离",
        {2},
        None,
        "partner_distance",
        "暂缓最终决定，不表示已经和好",
    ),
    "clarify": ("在例会上澄清传言", {3}, None, "clarified", "公开澄清事实；信用 +5，心绪消耗 -5"),
    "deliver": ("提交实验结果", {3}, None, "delivered", "正式交付实验结果；信用 +10，心绪消耗 -5"),
    "cut_ties": (
        "结束与孙淼的私人来往，仅保留工作沟通",
        {3},
        "sun",
        "sun_cut",
        "明确结束私人往来，工作职责继续履行",
    ),
    "keep_distance": (
        "暂不切割，保持距离继续观察",
        {3},
        "sun",
        "sun_observe",
        "保持距离，保留未来决定的空间",
    ),
    "leave": (
        "选择离开当前环境",
        {1, 2, 3},
        None,
        "",
        "结束本局职场故事；未发生的关系变化不会补写",
    ),
    "next": ("继续故事", {1, 2, 3}, None, "", "进入下一幕"),
}


def transition(
    state: GameState,
    action: str,
    npc: str = "sun",
    params: dict[str, Any] | None = None,
    event_id: str = "preview",
) -> tuple[GameState, str]:
    if isinstance(state, GameStateV3):
        from .story_rules import transition_v3

        return transition_v3(state, action, npc, params, event_id)
    if not isinstance(state, GameStateV2):
        return apply_player(state, action)
    if action in {"propose", "cancel_proposal"}:
        return state.model_copy(deep=True), ""
    if action == "epilogue":
        return apply_player(state, action)
    if state.ending:
        raise RuleError("故事已经结束。")
    if action in {"cut_ties", "keep_distance"} and not {"clarified", "delivered"} <= set(
        state.flags
    ):
        raise RuleError("请先完成第三幕的公开澄清和实验交付。")
    if action in WORK:
        if action == "joint_review":
            if npc != "li":
                raise RuleError("联合沟通由李姐完成审核。")
            if "joint_review" in state.flags:
                raise RuleError("联合沟通已经完成。")
            if not {"supported", "materials"} <= set(state.flags):
                raise RuleError("请先取得张工支持并补齐材料。")
            result, _ = apply_npc(state, "li", "approve_purchase")
            result.flags = sorted(set(result.flags) | {"joint_review"})
            return result, "张工参加联合沟通，说明进度风险；李姐核对材料后完成审核。"
        required = {"support_project": "zhang", "approve_purchase": "li"}.get(action)
        if required and npc != required:
            raise RuleError("请联系有权限的角色。")
        if action == "approve_purchase" and state.procurement == "approved":
            raise RuleError("采购已经审核通过。")
        flag = {"request_materials": "requirements", "support_project": "supported"}.get(action)
        if flag and flag in state.flags:
            raise RuleError("这项操作已经完成。")
        return apply_npc(state, npc, action)
    if action == "verify_notice":
        if state.act not in {1, 2} or "confronted" not in state.flags:
            raise RuleError("公开争议发生后才能核对通知。")
        if "notice_checked" in state.flags:
            raise RuleError("通知已经核对。")
        result = state.model_copy(deep=True)
        result.flags = sorted(set(result.flags) | {"notice_checked"})
        return result, "你与李姐核对了通知记录：现有记录无法确认遗漏责任，尚未查明的部分如实保留。"
    if action in {"partner_breakup", "partner_distance"}:
        if state.act != 2 or state.procurement != "approved":
            raise RuleError("请先完成第二幕采购事项。")
        if state.partner_choice:
            raise RuleError("伴侣关系选择已经记录。")
        result = state.model_copy(deep=True)
        result.partner_choice = "breakup" if action == "partner_breakup" else "distance"
        result.flags = sorted(set(result.flags) | {action, "personal_resolved"})
        return result, (
            "那天晚上，你向谢川明确提出分手；你仍与家人保持关爱，也保留自己的生活决定权。"
            if action == "partner_breakup"
            else "那天晚上，你向谢川说清边界，选择暂时保持距离。你没有承诺和好，最终决定仍由自己作出。"
        )
    if action == "next" and state.act == 2 and not state.partner_choice:
        raise RuleError("请先在幕间选择如何处理与谢川的关系。")
    result, text = apply_player(state, action)
    if isinstance(result, GameStateV2):
        result.node = (
            "ending" if result.ending else f"act_{result.act}" if result.act else "prologue"
        )
        if not result.partner_choice:
            result.flags = [f for f in result.flags if f != "personal_resolved"]
        if result.ending:
            result.ending_id = (
                "leave"
                if action == "leave"
                else "sun_cut"
                if "sun_cut" in result.flags
                else "sun_observe"
            )
    return result, text


def available_actions(state: GameState) -> list[AvailableAction]:
    if isinstance(state, GameStateV3):
        from .phone_choices import RUMOR_CHOICES, selected_rumor_choice
        from .story_rules import CATALOG as V3_CATALOG
        from .story_rules import action_effect, requires_confirmation

        selected = selected_rumor_choice(state.flags) if state.act == 3 else None
        result: list[AvailableAction] = []
        if state.ending:
            return result
        for action, (label, acts, target, flag, _effect) in V3_CATALOG.items():
            if state.act not in acts or action == "leave":
                continue
            reason = ""
            try:
                transition(
                    state,
                    action,
                    target or "sun",
                    params={"evidence": ["quote", "purpose"]}
                    if action == "supplement"
                    else {"boundary_response": "decline"}
                    if action == "follow_up"
                    else {"support_kind": "leave", "reason": "预览", "plan": "预览"}
                    if action == "draft_support"
                    else None,
                )
            except RuleError as exc:
                reason = str(exc)
            result.append(
                AvailableAction(
                    action=action,
                    label=label,
                    target=target,
                    enabled=not reason,
                    completed=bool(
                        (action not in RUMOR_CHOICES or state.act != 3 or action == selected)
                        and flag
                        and (
                            f"{flag}:act_{state.act}"
                            if action
                            in {
                                "boundary",
                                "appease",
                                "public_confront",
                                "rest",
                                "request_help",
                                "report",
                            }
                            else flag
                        )
                        in state.flags
                    ),
                    requires_confirmation=requires_confirmation(state, action),
                    reason=reason,
                    effect=action_effect(state, action),
                )
            )
        return result
    if not isinstance(state, GameStateV2) or state.ending:
        return []
    result = []
    flags = set(state.flags) | ({"purchase_approved"} if state.procurement == "approved" else set())
    for action, (label, acts, target, flag, effect) in CATALOG.items():
        if state.act not in acts:
            continue
        if action.startswith("partner_") and state.procurement != "approved":
            continue
        if action in {"cut_ties", "keep_distance"} and not {"clarified", "delivered"} <= flags:
            continue
        if action == "verify_notice" and "confronted" not in flags:
            continue
        if action == "joint_review" and "supported" not in flags:
            continue
        completed = bool(flag and flag in flags)
        reason = ""
        try:
            transition(state, action, target or "sun")
        except RuleError as e:
            reason = str(e)
        result.append(
            AvailableAction(
                action=action,
                label=label,
                target=target,
                enabled=not reason,
                completed=completed,
                requires_confirmation=action in MAJOR,
                reason=reason,
                effect=effect,
            )
        )
    return result


def effects(before: GameState, after: GameState, text: str) -> list[dict[str, Any]]:
    if before == after:
        return []
    facts = []
    if isinstance(before, GameStateV3) and isinstance(after, GameStateV3):
        for area in ("work", "relationship"):
            old = getattr(before, area).facts
            new = getattr(after, area).facts
            for key in sorted(old.keys() | new.keys()):
                if old.get(key) != new.get(key):
                    facts.append(
                        {
                            "before": old[key].detail if key in old else None,
                            "after": new[key].detail if key in new else None,
                        }
                    )
    return [
        {
            "text": text,
            "facts": facts,
            "changes": {
                key: getattr(after, key) - getattr(before, key)
                for key in (
                    ("credit", "rumination", "pressure", "heat")
                    if isinstance(before, GameStateV3)
                    else ("credit", "stress", "heat")
                )
                if getattr(after, key) != getattr(before, key)
            },
        }
    ]


def role_actions(state: GameState, npc: str) -> list[AvailableAction]:
    """The agent sees the same catalogue, scoped to its work/confirmation tools."""
    if isinstance(state, GameStateV3):
        return [
            a
            for a in available_actions(state)
            if (a.target in {None, npc} or (a.action == "request_materials" and npc == "li"))
            and not a.action.startswith("partner_")
        ]
    allowed = {
        "boundary",
        "report",
        "request_materials",
        "approve_purchase",
        "support_project",
        "public_confront",
        "cut_ties",
        "keep_distance",
        "leave",
    }
    return [
        action.model_copy(update={"target": npc} if action.action == "request_materials" else {})
        for action in available_actions(state)
        if action.action in allowed
        and (
            action.target in {None, npc}
            or (action.action == "request_materials" and npc in {"sun", "li"})
        )
    ]
