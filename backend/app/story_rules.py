"""v3 deterministic rules. Only committed actions create event-backed facts.

The caller supplies the event id inside its transaction. Availability checks use
an unpersisted preview id; generated dialogue never calls this module directly.
"""

from typing import Any, Literal, cast

from .domain import RuleError
from .game_types import (
    EndingResult,
    ExitDraft,
    Fact,
    GameStateV3,
    ReviewRecord,
    Submission,
    SupportApplication,
)

# label, acts, target, completion fact, explanation (shared catalogue shape)
CATALOG = {
    "begin": ("进入第一幕", {0}, None, "started", "继续序幕之后的故事"),
    "join_farewell": (
        "欢送会的名单，可以把我加上吗？",
        {1},
        "sun",
        "farewell_requested",
        "提出参加请求，等待现场回应",
    ),
    "attend_farewell": (
        "前往食堂参加欢送会",
        {1},
        None,
        "farewell_attended",
        "在名单确认后实际参加",
    ),
    "contact_wang": ("给王会计送上祝福", {1, 2, 3}, "wang", "wang_contacted", "保持私人联系"),
    "boundary": ("说清我的边界", {1, 2, 3}, "sun", "boundary", "明确不接受被替代决定"),
    "public_confront": ("公开质问", {1, 2, 3}, "sun", "confronted", "公开争议会增加关注，需要确认"),
    "appease": ("暂时忍让", {1, 2, 3}, "sun", "appeased", "内耗 +10"),
    "verify_notice": ("核对通知记录", {1, 2, 3}, "li", "notice_checked", "未知责任仍保持未知"),
    "submit_purchase": (
        "提交采购申请",
        {2, 3},
        "sun",
        "purchase_submitted",
        "孙淼登记并提出材料意见",
    ),
    "request_materials": (
        "查看退回要求",
        {2, 3},
        "sun",
        "requirements",
        "核对普通采购模板；加急申请另附依据",
    ),
    "supplement": ("补充材料并重新提交", {2, 3}, "sun", "materials", "保存材料版本和退回意见"),
    "dispute_return": ("请李姐复核退回依据", {2, 3}, "li", "return_disputed", "按记录核对审核要求"),
    "report": ("向张工同步风险", {2, 3}, "zhang", "reported", "同步不等于审批"),
    "support_project": ("请张工协调项目", {2, 3}, "zhang", "supported", "项目支持不替代财务审核"),
    "approve_purchase": (
        "提交李姐审核",
        {2, 3},
        "li",
        "purchase_approved",
        "按申请类型核对材料后审核",
    ),
    "joint_review": ("联合复核采购", {2, 3}, "li", "joint_review", "张工协调，李姐审核"),
    "clarify": ("在工作群澄清", {3}, None, "clarification_sent", "回应跳槽传言，不指认未知源头"),
    "review_clarification": ("查看群内后续回应", {3}, None, "clarified", "查看转述者是否更正说法"),
    "trace_rumor": (
        "向李姐核对传播记录",
        {3},
        "li",
        "rumor_verified",
        "核实已有转发记录，保留未知源头",
    ),
    "confirm_responsibility": (
        "确认反馈责任",
        {3},
        "li",
        "responsibility",
        "根据退回记录确认反馈责任",
    ),
    "change_rules": (
        "提出统一反馈与处理时限",
        {3},
        "li",
        "rules_proposed",
        "由李姐确认新约定，后续还需实际执行",
    ),
    "apply_rules": (
        "按新约定处理后续工作",
        {3},
        "li",
        "rules_changed",
        "在项目复核后实际采用新的反馈流程",
    ),
    "deliver": ("提交实验结果", {3}, "zhang", "delivered", "交付完整项目报告"),
    "request_extension": ("申请延期并获批", {2, 3}, "zhang", "extension", "记录新的交付时间"),
    "project_review": (
        "进入项目复核",
        {3},
        "zhang",
        "project_reviewed",
        "推进节点：未交付且未延期会产生转交",
    ),
    "correct_loss": (
        "复核转交并恢复职责",
        {3},
        "zhang",
        "loss_corrected",
        "交付后申请纠正实际损失",
    ),
    "cut_ties": ("仅保留职业关系", {3}, "sun", "sun_cut", "明确私人关系决定，需要确认"),
    "keep_distance": ("暂不决定关系", {3}, "sun", "sun_observe", "保留决定空间"),
    "repair_friendship": (
        "提出保留友谊",
        {3},
        "sun",
        "friendship_offer",
        "表达保留友谊的意愿，等待对方回应",
    ),
    "acknowledge_harm": (
        "具体谈清伤害",
        {3},
        "sun",
        "harm",
        "孙淼承认代替决定和不当玩笑造成的伤害",
    ),
    "complete_remedy": ("落实具体补救", {3}, "sun", "remedy", "更正对外说法并补发完整通知"),
    "follow_up": ("进行后续协作", {3}, "sun", "follow_up", "再次协作检验是否先询问意愿、尊重边界"),
    "partner_breakup": ("与谢川分手", {2, 3}, None, "partner_breakup", "私人关系决定"),
    "partner_distance": ("与谢川暂时保持距离", {2, 3}, None, "partner_distance", "私人关系决定"),
    "partner_undecided": ("私人关系暂不决定", {2, 3}, None, "partner_undecided", "保留自主选择"),
    "draft_support": ("预览请假或求助申请", {1, 2, 3}, None, "", "核对理由及工作安排，草稿不提交"),
    "submit_support": ("正式提交申请", {1, 2, 3}, None, "", "提交不代表已经获批"),
    "review_support": ("查看张工的处理意见", {1, 2, 3}, "zhang", "", "确认交接或分工安排"),
    "rest": ("按批准安排休息", {1, 2, 3}, None, "rested", "落实休息，压力 -10"),
    "request_help": ("确认分工已经落实", {1, 2, 3}, "zhang", "helped", "实际支持，压力 -10"),
    "draft_exit": ("预览退出申请", {1, 2, 3}, None, "", "草稿不会让故事结束"),
    "leave": ("确认提交退出申请", {1, 2, 3}, None, "", "仅正式提交后产生退出事实"),
    "submit_exit": ("确认提交退出申请", {1, 2, 3}, None, "", "提交离职、调岗或退出合作申请"),
    "next": ("进入下一幕", {1, 2}, None, "", "未解决事项随故事保留"),
    "close_story": ("收束本局", {3}, None, "", "按已发生事实判定结局"),
}
MAJOR = {
    "project_review",
    "public_confront",
    "cut_ties",
    "keep_distance",
    "repair_friendship",
    "partner_breakup",
    "partner_distance",
    "leave",
    "submit_exit",
    "close_story",
}
TITLES = dict(
    active_exit="主动转身",
    career_cost="付出代价",
    rules_rewritten="改写规则",
    limited_repair="有限修复",
    professional_boundary="各自为界",
    unresolved="尚未破局",
)
EVIDENCE = {"quote", "purpose", "urgency"}


def review_risk(state: GameStateV3) -> bool:
    return not {"delivered", "extension"} & state.work.facts.keys()


def requires_confirmation(state: GameStateV3, action: str) -> bool:
    return action in MAJOR and (action != "project_review" or review_risk(state))


def action_effect(state: GameStateV3, action: str) -> str:
    if action == "project_review":
        return (
            "尚未交付，也未获延期。现在复核将转交负责人职责：专业信用 -20，工作压力 +20。完成交付后仍可申请纠正。"
            if review_risk(state)
            else "已记录交付或延期。本次复核会推进至后续协作，不会因未交付且未延期而转交职责。"
        )
    if state.content_revision >= 3:
        if action in {"supplement", "dispute_return"}:
            return "真正补齐缺项或成功纠正不合理退回可恢复信用与减轻压力，每局只计一次；重复提交合格材料不奖励。"
        if action == "appease":
            return "暂缓回应可保留精力，但问题仍未解决：首次工作压力 -5、内耗 +5。"
        if action == "public_confront":
            return "公开表达会增加关注；有已核验传播记录或有效采购复核依据时不扣信用。相同收益或代价每局只计一次。"
    return CATALOG[action][4]


def ending_for(s: GameStateV3) -> EndingResult:
    w, r = s.work.facts, s.relationship.facts
    resolved = {"purchase_approved", "clarified", "delivered"} <= w.keys()
    route = (
        "active_exit"
        if s.exit_draft and s.exit_draft.submitted
        else "career_cost"
        if "career_loss" in w and "loss_corrected" not in w
        else "rules_rewritten"
        if {"purchase_approved", "clarified", "responsibility", "rules_changed"} <= w.keys()
        else "limited_repair"
        if s.relationship.intention == "friendship"
        and {"friendship", "harm", "remedy", "follow_up"} <= r.keys()
        else "professional_boundary"
        if resolved and s.relationship.intention == "professional" and "follow_up" in r
        else "unresolved"
    )
    unresolved = [
        label
        for key, label, occurred in [
            ("purchase_approved", "采购尚未通过", "purchase_submitted" in w),
            ("clarified", "谣言尚未澄清", "rumor_spread" in w),
            ("delivered", "项目尚未交付", "purchase_submitted" in w),
        ]
        if occurred and key not in w
    ]
    if "career_loss" in w and "loss_corrected" not in w:
        unresolved.append("项目职责转交尚未纠正")
    facts = {**w, **r}
    important = [
        "exit_submitted",
        "career_loss",
        "loss_corrected",
        "rules_changed",
        "follow_up",
        "clarified",
        "purchase_approved",
        "boundary",
    ]
    ids = list(dict.fromkeys(facts[k].event_id for k in important if k in facts))[:3]
    return EndingResult(
        id=route,
        title=TITLES[route],
        achievements=[
            f.detail
            for k, f in facts.items()
            if k
            in {
                "exit_submitted",
                "purchase_approved",
                "clarified",
                "delivered",
                "rules_changed",
                "remedy",
                "follow_up",
                "loss_corrected",
            }
        ],
        unresolved=unresolved,
        key_event_ids=ids,
    )


def transition_v3(
    before: GameStateV3,
    action: str,
    npc: str = "sun",
    params: dict[str, Any] | None = None,
    event_id: str = "preview",
) -> tuple[GameStateV3, str]:
    s = before.model_copy(deep=True)
    params = params or {}
    if action in {"propose", "cancel_proposal"}:
        return s, ""
    if s.ending:
        raise RuleError("故事已收束，只能阅读或从关键节点重玩。")
    if action == "speak":
        s.quiet_turns += 1
        return s, ""
    entry = CATALOG.get(action)
    if not entry or s.act not in entry[1]:
        raise RuleError("当前节点不能执行这项行动。")
    if entry[2] and npc != entry[2] and not (action == "request_materials" and npc == "li"):
        raise RuleError("请联系负责这项行动的角色。")
    w, r = s.work.facts, s.relationship.facts
    flag = entry[3]
    repeatable = action in {
        "boundary",
        "appease",
        "public_confront",
        "rest",
        "request_help",
        "report",
    }
    result_key = f"{flag}:act_{s.act}" if repeatable else flag
    if result_key and result_key in s.flags:
        raise RuleError("这项结果已经记录，不会重复计分。")

    def need(ok: bool, reason: str) -> None:
        if not ok:
            raise RuleError(reason)

    def record(key: str, detail: str, relation: bool = False) -> None:
        (r if relation else w)[key] = Fact(event_id=event_id, detail=detail)
        if key not in s.flags:
            s.flags.append(key)

    def score(key: str, **deltas: int) -> None:
        if key in s.scored:
            return
        for metric, delta in deltas.items():
            setattr(s, metric, max(0, min(100, getattr(s, metric) + delta)))
        s.scored.append(key)

    text = entry[4]
    if action in {"begin", "next"}:
        s.act += 1
        s.tick += 1
        s.node = f"act_{s.act}"
        if action == "begin":
            record("started", "在茶水间听见孙淼和李姐讨论欢送会，没有替玩家决定是否参加")
        if s.act == 2:
            # Authored starting evidence, attached to the chapter-entry event.
            s.work.purchase = "returned"
            s.work.submissions.append(
                Submission(
                    event_id=event_id,
                    version=1,
                    purpose="当前实验项目耗材采购（普通申请）",
                    evidence=["quote", "purpose"],
                    status="returned",
                    feedback="有些地方不太规范，你先重新整理吧。",
                )
            )
            s.work.reviews.append(
                ReviewRecord(
                    event_id=event_id,
                    version=1,
                    actor="sun",
                    decision="退回",
                    detail="有些地方不太规范，你先重新整理吧。",
                    time="周二 · 开屏前",
                )
            )
            record(
                "purchase_submitted", "昨日已按普通采购模板提交报价和用途说明；孙淼以模糊理由退回"
            )
            score("purchase_returned", pressure=15)
        if s.act == 3:
            record(
                "rumor_spread",
                "办公室同事转述周菱菱准备跳槽、正在看机会，并把整理工作记录当作猜测依据；最初来源未核实",
            )
            score("rumor_spread", heat=20, rumination=10, pressure=10)
    elif action == "join_farewell":
        record(flag, "你提出把自己加入王会计欢送会名单的请求")
        s.node = "act_1_invitation"
        text = "你问孙淼：欢送会的名单，可以把我加上吗？李姐拿出了名单，准备核对。"
    elif action == "attend_farewell":
        need("farewell_requested" in w, "请先提出参加欢送会的请求。")
        record("farewell_invited", "李姐核对并确认加入名单，告知食堂地点和开始时间")
        record(flag, "收到名单确认后，你前往食堂参加了王会计的欢送会")
        s.node = "act_1_farewell"
        text = "李姐确认了你的名字，你按通知来到食堂，向王会计送上祝福。"
    elif action == "submit_purchase":
        need(not s.work.submissions, "昨日的申请已在系统中，请查看退回意见、补充说明或申请复核。")
        purpose = str(params.get("purpose", "实验项目耗材采购"))[:1000]
        s.work.purchase = "returned"
        text = "孙淼退回申请：请补齐报价、实验用途和加急依据；审核要求由李姐复核。"
        s.work.submissions.append(
            Submission(
                event_id=event_id,
                version=1,
                purpose=purpose,
                evidence=[],
                status="returned",
                feedback=text,
            )
        )
        record("purchase_submitted", "采购申请已提交并收到具体退回意见")
        score("purchase_returned", pressure=15)
    elif action in {"request_materials", "supplement", "dispute_return"}:
        need(bool(s.work.submissions), "请先提交采购申请。")
        if action == "supplement":
            latest = s.work.submissions[-1]
            purchase_kind = params.get("purchase_kind", latest.kind)
            need(purchase_kind in {"standard", "urgent"}, "请选择普通或加急采购。")
            required = {"quote", "purpose"} | (
                {"urgency"} if s.content_revision >= 3 and purchase_kind == "urgent" else set()
            )
            missing = required - set(latest.evidence)
            evidence = params.get("evidence", [])
            need(
                isinstance(evidence, list) and required <= set(evidence) <= EVIDENCE,
                "普通申请需要报价和用途说明；选择加急时另附加急依据。",
            )
            s.work.submissions.append(
                Submission(
                    event_id=event_id,
                    version=len(s.work.submissions) + 1,
                    kind=purchase_kind if s.content_revision >= 3 else "standard",
                    purpose=s.work.submissions[-1].purpose,
                    evidence=sorted(set(evidence)),
                    status="resubmitted",
                )
            )
            s.work.purchase = "review"
            record("materials", "已再次提交报价及用途说明，附加材料按本次实际选择保留")
            if s.content_revision < 3 or missing:
                score("materials", credit=10, pressure=-5)
            else:
                text = "原材料已符合本次申请要求；再次提交仅保存版本，没有重复劳动奖励。可请李姐复核退回依据。"
        else:
            text = (
                "李姐核对普通采购模板：原申请已有报价和用途说明，无需加急依据。原退回未指出实际缺项，应恢复审核并写清处理意见。"
                if action == "dispute_return"
                else "普通采购模板要求报价与用途说明；只有申请加急时才需要加急依据。原退回尚未指出哪项不符，请结合原始附件核对。"
            )
            latest = s.work.submissions[-1]
            required = {"quote", "purpose"} | (
                {"urgency"} if s.content_revision >= 3 and latest.kind == "urgent" else set()
            )
            if s.content_revision >= 3 and action == "dispute_return":
                text = (
                    "李姐核对本次申请：材料符合要求，原退回未指出实际缺项；恢复审核并更正处理意见。"
                    if required <= set(latest.evidence)
                    else "李姐核对本次申请：仍缺少必要材料，复核不能替代补齐；加急申请还需加急依据。"
                )
            record(flag, text)
            if action == "dispute_return":
                if required <= set(latest.evidence):
                    record(
                        "materials",
                        "李姐核验本次申请符合材料要求，原始材料有效，无需重复补齐"
                        if s.content_revision >= 3
                        else "李姐核验原申请符合普通采购模板，原始材料有效，无需重复补齐",
                    )
                    s.work.purchase = "review"
                    if s.content_revision >= 3:
                        score("materials", credit=10, pressure=-5)
                s.work.reviews.append(
                    ReviewRecord(
                        event_id=event_id,
                        version=latest.version,
                        actor="li",
                        decision="复核退回依据",
                        detail=text,
                        time="本幕 · 复核时",
                    )
                )
    elif action in {"approve_purchase", "joint_review"}:
        need("materials" in w, "请先补充材料，或请李姐复核原申请是否合格。")
        need(action != "joint_review" or "supported" in w, "请先取得张工协调支持。")
        need(s.work.purchase != "approved", "采购已经通过。")
        if s.content_revision >= 3:
            latest = s.work.submissions[-1]
            required = {"quote", "purpose"} | ({"urgency"} if latest.kind == "urgent" else set())
            need(required <= set(latest.evidence), "本次申请仍缺必要材料；加急采购需要加急依据。")
        s.work.purchase = "approved"
        s.procurement = "approved"
        s.work.reviews.append(
            ReviewRecord(
                event_id=event_id,
                version=s.work.submissions[-1].version,
                actor="li",
                decision="审核通过",
                detail="李姐核对报价、用途及本次申请要求的材料后批准采购申请。"
                if s.content_revision >= 3
                else "李姐核对报价、用途及本次实际提交的材料后批准普通采购申请。",
                time="本幕 · 审核时",
            )
        )
        record("purchase_approved", "李姐依据完整材料批准采购")
        if action == "joint_review":
            record("joint_review", "张工协调，李姐完成联合审核")
        text = "李姐核对本次申请所需材料后批准采购；审批结果已写入独立处理记录。"
    elif action == "support_project":
        need("reported" in w, "先向张工同步项目风险。")
        record(flag, "张工安排项目协调支持")
    elif action == "clarify":
        text = "你在工作群发出澄清：整理工作记录不等于已经决定跳槽。关于我的去留，请以我自己的明确说明为准；请不要把推测当作事实继续转述。"
        record(
            flag,
            "你在工作群说明：整理工作记录不等于已经决定跳槽；个人去留以本人明确表达为准，未指认未经核实的源头",
        )
        score(flag, credit=5, pressure=-5, heat=-5)
    elif action == "review_clarification":
        need("clarification_sent" in w, "先发出澄清，才能查看相关同事的后续回应。")
        text = "同事群像：之前我们把整理工作记录当作准备跳槽的证据，这样推测没有依据。我们已在原来转述的群里补充更正，不再把猜测说成你的决定。李姐：已看到更正，但最早的消息来源仍没有查实。"
        record(
            flag,
            "相关转述者已在原传播范围更正跳槽说法；最初源头仍未知，不代表所有同事的私人想法都已改变",
        )
    elif action == "trace_rumor":
        record(flag, "李姐核对群内转发环节；最初来源仍无法确认")
    elif action == "confirm_responsibility":
        need(
            "purchase_submitted" in w and "return_disputed" in w, "先保留退回记录并请李姐复核依据。"
        )
        record(flag, "李姐依据退回记录确认孙淼承担完整反馈的职责；未认定谣言源头")
    elif action == "change_rules":
        need(
            {"purchase_approved", "clarified", "responsibility"} <= w.keys(),
            "先完成采购、澄清和责任确认。",
        )
        text = "你提出统一反馈与处理时限。李姐：我确认这项约定，孙淼一次性列出问题，我在两日内复核，逾期由张工协调。下一次工作按这个办法处理，再检查是否有效。"
        record(flag, "李姐已确认新的反馈责任和两日处理时限，尚待后续工作实际执行")
    elif action == "apply_rules":
        need(
            {"rules_proposed", "project_reviewed"} <= w.keys(),
            "先取得规则确认，并推进到后续项目复核。",
        )
        text = "后续工作记录：孙淼在同一份意见中列全了待核对内容；李姐按约定时限完成复核并回填结果，张工收到处理状态。新的反馈责任和时限在这次协作中实际执行。"
        record(flag, "新的统一反馈与两日复核约定已用于后续工作，责任人、反馈内容及处理结果均已记录")
    elif action == "deliver":
        need("purchase_approved" in w, "完成采购后才能提交实验成果。")
        text = "你提交了实验结果和项目报告。张工确认收到交付材料，并将本次交付记入项目记录。"
        record(flag, "实验结果和项目报告已交付张工")
        score(flag, credit=10, pressure=-5, heat=-5)
    elif action == "project_review":
        text = "项目复核已完成，已记录交付或延期，本次未转交职责。"
        s.tick += 1
        s.node = "act_3_follow_up"
        record(flag, "第三幕项目复核已经发生")
        if not {"delivered", "extension"} & w.keys():
            record("career_loss", "复核时既未交付也未获延期，项目负责人职责被转交")
            score("career_loss", credit=-20, pressure=20)
            text = "项目复核决定转交你的负责人职责；完成交付后仍可申请纠正。"
    elif action == "correct_loss":
        need({"career_loss", "delivered"} <= w.keys(), "发生职责转交并完成交付后才能申请纠正。")
        record(flag, "张工复核交付结果，恢复了项目职责并更正记录")
    elif action in {"cut_ties", "keep_distance", "repair_friendship"}:
        s.relationship.intention = cast(
            Literal["professional", "undecided", "friendship"],
            {
                "cut_ties": "professional",
                "keep_distance": "undecided",
                "repair_friendship": "friendship",
            }[action],
        )
        # A changed intention requires a fresh demonstration, never reuses old repair evidence.
        r.pop("follow_up", None)
        s.flags = [f for f in s.flags if f != "follow_up"]
        text = {
            "cut_ties": "你明确仅保留工作沟通，孙淼表示接受。",
            "keep_distance": "你暂不决定关系，双方继续履行工作职责。",
            "repair_friendship": "你表达了愿意保留友谊的想法，同时希望先谈清具体伤害；孙淼尚未回应。",
        }[action]
        record(flag, text, True)
    elif action == "acknowledge_harm":
        need(s.relationship.intention == "friendship", "先表达是否希望保留友谊。")
        text = "孙淼：我也愿意试着保留朋友关系。但我不该替你决定是否参加，也不该拿羽绒服开那种玩笑，再用‘你太敏感’搪塞。是这些具体做法伤害了你，不能只说一句对不起就算过去。"
        record("friendship", "孙淼回应愿意尝试保留友谊；与玩家先前表达的意愿一致", True)
        record(flag, "孙淼明确承认代替决定和羽绒服玩笑造成的具体伤害", True)
    elif action == "complete_remedy":
        need("harm" in r, "先谈清具体伤害。")
        attended = "farewell_attended" in w
        text = (
            "孙淼向当时在场的同事更正：‘我没有问过菱菱，就替她决定不参加，还把她说成容易生气，这是我的问题。’她把后续工作的完整通知发给了你，并确认以后先询问意愿。"
            + (
                "你后来已经参加了欢送会；这次补救针对的是代替你决定和不当评价的做法。"
                if attended
                else "已经错过的欢送会机会无法靠补发旧通知挽回。"
            )
        )
        record(
            flag,
            "孙淼已向有关同事更正代替决定的说法，并补齐后续工作通知；"
            + (
                "玩家已实际参加欢送会，补救针对代替决定和不当评价"
                if attended
                else "未声称挽回已经错过的机会"
            ),
            True,
        )
    elif action == "follow_up":
        need("project_reviewed" in w, "先推进到第三幕项目复核后的协作。")
        need(s.relationship.intention != "undecided", "先明确希望保留友谊还是职业关系。")
        need(s.relationship.intention != "friendship" or "remedy" in r, "修复路线需先落实补救。")
        response = params.get("boundary_response")
        if not isinstance(response, str) or response not in {"decline", "agree", "ask_details"}:
            raise RuleError("请明确回应这次协作邀请，系统不会替你答应或拒绝。")
        replies = {
            "decline": (
                "这次聚餐我不参加，工作资料请照常发给我。",
                "好，我尊重你的安排。聚餐不影响工作资料，我已经把完整资料发给你了。",
            ),
            "agree": (
                "这次我愿意参加，请把具体安排和工作资料分别发给我。",
                "好的。我已分别发出安排与工作资料，以后也会先问你的意愿。",
            ),
            "ask_details": (
                "我想先知道安排，再决定是否参加。工作资料请先发我。",
                "可以，时间地点已经发给你，工作资料也已单独发送。参加与否等你决定，不催你。",
            ),
        }
        player_text, sun_text = replies[response]
        text = f"你：{player_text}\n孙淼：{sun_text}"
        record("follow_up_response", player_text, True)
        record(flag, sun_text, True)
    elif action.startswith("partner_"):
        need(s.partner_choice is None, "本局私人选择已经记录。")
        s.partner_choice = cast(
            Literal["breakup", "distance", "undecided"], action.removeprefix("partner_")
        )
        record(
            flag,
            {
                "breakup": "你与谢川分手，保留生活自主权",
                "distance": "你与谢川保持距离，尚未和好",
                "undecided": "你暂不决定与谢川的关系",
            }[s.partner_choice],
            True,
        )
    elif action == "draft_support":
        kind = params.get("support_kind")
        reason, plan = (
            str(params.get("reason") or "").strip(),
            str(params.get("plan") or "").strip(),
        )
        need(
            kind in {"leave", "help"} and bool(reason) and bool(plan),
            "请选择请假或求助，并填写理由及工作安排。",
        )
        need(len(reason) <= 1000 and len(plan) <= 1000, "理由和工作安排分别不超过1000字。")
        result_flag = "rested" if kind == "leave" else "helped"
        need(
            f"{result_flag}:act_{s.act}" not in s.flags,
            "本幕这一安排已经落实，不能重复领取同一效果。",
        )
        last = s.support_requests[-1] if s.support_requests else None
        need(
            not last or not last.submitted or bool(last.completion),
            "上一份申请还在处理中，请先查看处理意见并落实安排。",
        )
        new_application = SupportApplication(
            kind=cast(Literal["leave", "help"], kind),
            reason=reason,
            plan=plan,
            act=s.act,
            draft=Fact(event_id=event_id, detail="申请草稿已保存，尚未提交"),
        )
        if last and not last.submitted:
            s.support_requests[-1] = new_application
        else:
            s.support_requests.append(new_application)
        text = "申请草稿已保存。请核对理由及工作安排，再正式提交。"
    elif action in {"submit_support", "review_support", "rest", "request_help"}:
        application = s.support_requests[-1] if s.support_requests else None
        if application is None:
            raise RuleError("请先填写并预览请假或求助申请。")
        if action == "submit_support":
            need(application.submitted is None, "申请已经提交。")
            text = "申请已正式提交张工，等待确认工作交接或分工；尚未获批，也没有减少压力。"
            application.submitted = Fact(event_id=event_id, detail=text)
        elif action == "review_support":
            need(
                application.submitted is not None and application.approval is None,
                "先提交申请；已处理的申请无需重复审核。",
            )
            text = (
                "张工：同意这次请假。你列出的工作安排已纳入交接，紧急事项由我协调。请按安排休息。"
                if application.kind == "leave"
                else "张工：同意这次求助。按你列出的任务范围，我负责协调依赖和分工；请核对工作资料是否实际交到接手人。"
            )
            application.approval = Fact(event_id=event_id, detail=text)
        else:
            need(
                application.approval is not None and application.completion is None,
                "申请获批并实际落实后，才能记录恢复效果。",
            )
            need(
                application.kind == ("leave" if action == "rest" else "help"),
                "请按获批的申请类型执行。",
            )
            text = (
                "你完成交接后按批准安排休息，工作压力有所减轻。"
                if action == "rest"
                else "工作资料已交接到位，张工协调的分工开始执行，工作压力有所减轻。"
            )
            application.completion = Fact(event_id=event_id, detail=text)
            record(flag, text)
            score(result_key, pressure=-10)
            s.flags.append(result_key)
    elif action == "draft_exit":
        kind = params.get("kind", "resign")
        need(kind in {"resign", "transfer", "withdraw"}, "请选择有效的申请类型。")
        reason = str(params.get("reason", "希望重新安排自己的职业生活")).strip()
        need(bool(reason) and len(reason) <= 1000, "请填写不超过1000字的申请理由。")
        s.exit_draft = ExitDraft(kind=kind, reason=reason, event_id=event_id)
        text = "申请草稿已保存，请核对后正式确认提交；当前尚未退出。"
    elif action in {"submit_exit", "leave"}:
        need(s.exit_draft is not None, "请先在人事页填写并预览退出申请。")
        if s.exit_draft is None:
            raise RuleError("请先填写申请。")
        s.exit_draft.submitted = True
        label = {"resign": "离职", "transfer": "调岗", "withdraw": "退出合作"}[s.exit_draft.kind]
        record(
            "exit_submitted", f"已正式提交{label}申请，手续仍待后续办理，不代表已获批准或完成交接"
        )
    elif action != "close_story":
        text = {
            "contact_wang": "你向王会计送上祝福，保留与退休前辈的私人联系",
            "boundary": "你明确不接受别人代替决定或不当玩笑",
            "public_confront": "你在现场公开提出质问，争议受到更多关注",
            "verify_notice": "李姐核对通知记录，无法确认遗漏责任",
            "report": "你向张工同步了当前项目记录与交付安排，没有就个人去留作出声明"
            if s.act == 3
            else "你向张工同步了采购受阻的记录及项目风险",
            "request_extension": "张工确认延期，交付时间移到后续复核节点",
            "rest": "请假获准，你实际安排了休息",
            "request_help": "张工重新分配任务，求助得到落实",
            "appease": "你暂时忍让，把未说出口的话留在心里",
        }.get(action, text)
        record(flag, text, action in {"boundary", "contact_wang", "appease"})
        deltas = {
            "contact_wang": dict(credit=5, rumination=-5),
            "boundary": dict(credit=5, rumination=-5),
            "public_confront": dict(credit=-5, rumination=10, heat=20),
            "report": dict(credit=10, pressure=-5),
            "rest": dict(pressure=-10),
            "request_help": dict(pressure=-10),
            "appease": dict(rumination=10),
        }
        if s.content_revision >= 3:
            if action == "appease":
                text = "你选择暂缓回应，留出精力等待信息；当下工作压力略有缓解，未表达的困扰仍然存在，问题尚未解决。"
                record(flag, text, True)
                deltas["appease"] = dict(rumination=5, pressure=-5)
            if action == "public_confront" and (
                "rumor_verified" in w or {"return_disputed", "materials"} <= w.keys()
            ):
                text = (
                    "你依据已核对的记录公开质问，专业信用不因此扣减；公开争议仍增加关注与表达压力。"
                )
                record(flag, text)
                deltas["public_confront"] = dict(rumination=5, heat=20)
        score(
            flag
            if action == "report"
            or (s.content_revision >= 3 and action in {"boundary", "appease", "public_confront"})
            else result_key,
            **deltas.get(action, {}),
        )
        if repeatable:
            s.flags.append(result_key)
    if s.heat >= 70 and "company_review" not in w:
        record("company_review", "公司介入核查现有记录；信用高低不能代替证据")
    s.quiet_turns = 0
    if action in {"close_story", "submit_exit", "leave"}:
        s.outcome = ending_for(s)
        s.ending = s.outcome.title
        s.act = 4
        s.node = "ending"
        text = s.ending + "。" + "；".join(s.outcome.achievements + s.outcome.unresolved)
    return s, text
