"""Authored evidence, relationship gates and explicit tradeoffs. No LLM inference."""

from typing import Any

from .game_types import GameState

# These records are fictional story assets, never community evidence.
EVIDENCE = {
    "sun_claim": {
        "title": "孙淼的口径",
        "text": "孙淼说采购单一直缺少加急依据，所以没有往下转。她没有解释为何未及时通知你。",
        "npc": "sun",
    },
    "finance_claim": {
        "title": "李姐的收件记录",
        "text": "李姐说她周二10:20才收到转来的单据，发现加急依据需要改填正式表格；此前的两天不在她的审核环节。",
        "npc": "li",
    },
    "purchase_timeline": {
        "title": "采购流转日志",
        "text": "周五16:10：用途、报价、加急说明附件上传成功。周一09:05：出纳待转交。周二10:20：转入李姐审核。附件存在不等于格式合规，但两天延误发生在转交之前。",
        "npc": "li",
    },
    "sun_admission": {
        "title": "孙淼私下的解释",
        "text": "面对日志，孙淼改口说先放着是替你把关，还反问菱菱怎么连这也要计较。她没有否认暂缓转交，与先前“一直缺附件”的说法不一致；这是私聊口径矛盾，并非真诚认错或书面证词。",
        "npc": "sun",
    },
    "rumor_fragment": {
        "title": "群聊中的截取转述",
        "text": "工作群中有人转述：‘周凌说做不下去，要换地方。’目前只能确认这段转述存在，不能据此确认是谁最先造谣。",
        "npc": "sun",
    },
    "meeting_context": {
        "title": "完整会议纪要",
        "text": "原话是：‘如果原实验窗口排不上，需要考虑换一个合作实验室。’纪要讨论的是实验地点，并非个人跳槽；张工同意提供这一段作为澄清依据。",
        "npc": "zhang",
    },
    "rumor_witness": {
        "title": "孙淼听到的版本",
        "text": "孙淼用“关心菱菱”解释自己提过她要换地方，随即强调只是随口聊聊，不肯复述完整前后文。这能确认她参与转述，不能据此还原全部传播链；亲昵口吻不代表可靠。",
        "npc": "sun",
    },
}
# action: stage, label, target, evidence gained, credit/stress/heat, trust delta
RULES = {
    "ask_sun": (2, "问孙淼：采购单卡在哪一步", "sun", "sun_claim", (0, 3, 0), 10),
    "ask_li": (2, "问李姐：什么时候收到单据", "li", "finance_claim", (5, 2, 0), 10),
    "audit_purchase": (2, "调取采购流转日志", "li", "purchase_timeline", (5, 3, 0), 5),
    "confide_sun": (2, "私下追问孙淼为何延迟转交", "sun", "sun_admission", (0, 3, 0), 5),
    "settle_purchase": (2, "私下纠正流程，保留记录", "sun", None, (5, -5, -5), 5),
    "escalate_purchase": (2, "向张工提交延误记录", "zhang", None, (10, 10, 30), 10),
    "trace_rumor": (3, "保存群聊转述", "sun", "rumor_fragment", (0, 5, 5), 0),
    "ask_zhang": (3, "向张工核对完整会议纪要", "zhang", "meeting_context", (5, 0, 0), 10),
    "interview_sun": (3, "私下核对孙淼听到的版本", "sun", "rumor_witness", (0, 5, 0), 5),
    "resolve_rumor": (3, "私下纠正转述，暂不公开", "zhang", None, (0, -5, -10), 5),
    "publish_rumor": (3, "在例会上公开完整上下文", "zhang", None, (10, 10, 30), 0),
    "attend_review": (0, "参加公司协调，提交事实记录", "zhang", None, (0, -10, -20), 5),
    "take_break": (0, "暂停沟通，休整后再处理", "zhang", None, (0, -25, 0), 0),
}
DECISIONS = {"settle_purchase", "escalate_purchase", "resolve_rumor", "publish_rumor"}
TARGETS = {a: v[2] for a, v in RULES.items()}
PUBLIC_ACTIONS = {"escalate_purchase", "publish_rumor", "attend_review"}


def unavailable(s: GameState, action: str) -> str:
    if action not in RULES:
        return "未知调查行动。"
    stage = RULES[action][0]
    flag = action if action != "take_break" else f"rested_{s.act}"
    if s.ending or s.act not in {2, 3} or (stage and s.act != stage):
        return "当前场景无法执行。"
    if flag in s.flags:
        return "已完成"
    e, f = set(s.evidence), set(s.flags)
    if action == "audit_purchase" and s.credit < 55 and s.trust.li < 55:
        return "需要专业信用55或李姐信任55；先核对她的收件记录。"
    if action == "confide_sun":
        if s.trust.sun < 60:
            return "孙淼仍有戒心，需要熟悉度60；可以先核对公开记录。"
        if "purchase_timeline" not in e:
            return "先取得流转日志，再具体追问。"
    if action == "interview_sun" and s.trust.sun < 60:
        return "孙淼仍有戒心，需要熟悉度60；仍可从群聊和张工处查证。"
    if action == "ask_zhang" and s.trust.zhang < 55 and s.credit < 70 and "rumor_fragment" not in e:
        return "先保存具体转述，或达到张工信任55／专业信用70，再请她调取纪要。"
    if action in {"settle_purchase", "escalate_purchase"}:
        if not {"purchase_timeline", "finance_claim"} <= e:
            return "先核对李姐口径与采购日志，避免只凭猜测归责。"
        if f & {"settle_purchase", "escalate_purchase"}:
            return "已选择另一种处理方式。"
        if action == "escalate_purchase" and s.credit < 60 and s.trust.zhang < 55:
            return "需要专业信用60或张工信任55，才能发起正式核查。"
    if action in {"resolve_rumor", "publish_rumor"}:
        if not {"rumor_fragment", "meeting_context"} <= e:
            return "先取得群聊转述和完整纪要，核对前后文。"
        if f & {"resolve_rumor", "publish_rumor", "clarified", "rumor_documented"}:
            return "传言处理方式已经确定。"
    if action == "attend_review" and "company_review" not in f:
        return "公司尚未启动协调。"
    if action == "take_break" and s.stress < 45:
        return "内耗达到45时可以安排一次休整。"
    return ""


def apply(s: GameState, action: str) -> tuple[GameState, str]:
    from .domain import RuleError

    reason = unavailable(s, action)
    if reason:
        raise RuleError(reason)
    _, label, npc, evidence, deltas, trust_delta = RULES[action]
    s.flags.append(action if action != "take_break" else f"rested_{s.act}")
    if action in {"ask_sun", "ask_li"} and "requirements" not in s.flags:
        s.flags.append("requirements")
    if evidence and evidence not in s.evidence:
        s.evidence.append(evidence)
    setattr(s.trust, npc, min(100, max(0, getattr(s.trust, npc) + trust_delta)))
    for key, delta in zip(("credit", "stress", "heat"), deltas, strict=True):
        setattr(s, key, min(100, max(0, getattr(s, key) + delta)))
    if action == "settle_purchase":
        s.consequences.append(
            "你要求孙淼按书面时限转交，她表面应下；保留记录让流程可追查，但不意味着她已改变，也没有形成公司责任认定。"
        )
    elif action == "escalate_purchase":
        s.trust.sun = max(0, s.trust.sun - 20)
        s.consequences.append(
            "张工收到延误记录，要求明确每个节点的负责人；流程更透明，但孙淼认为你越级，关系变得疏远。"
        )
    elif action == "resolve_rumor":
        s.consequences.append(
            "张工私下更正转述，并保留原始纪要；核心同事了解了事实，但外围同事未必看到更正。"
        )
    elif action == "publish_rumor":
        s.trust.sun = max(0, s.trust.sun - 10)
        s.consequences.append(
            "完整上下文进入例会记录，‘跳槽’说法得到公开纠正；讨论范围也扩大，办公室更加关注这次冲突。"
        )
    elif action == "attend_review":
        if s.credit >= 65 and s.evidence:
            s.flags.append("review_supported")
            s.consequences.append(
                "公司协调采信了可核对的记录，要求按事实处理，不再以传言评价你的工作。"
            )
        else:
            s.flags.append("review_inconclusive")
            s.consequences.append(
                "公司协调未能确认责任，要求双方停止扩大冲突并补充书面记录；没有替任何一方背书。"
            )
    elif action == "take_break":
        s.consequences.append(
            "你暂停了一轮沟通，内耗降低；未完成的调查仍可继续，已经掌握的记录不会丢失。"
        )
    return s, f"你选择：{label}。" + (EVIDENCE[evidence]["text"] if evidence else "")


def thresholds(s: GameState) -> None:
    if s.heat >= 60 and "company_review" not in s.flags:
        s.flags.append("company_review")
        s.consequences.append(
            "舆论温度达到60，公司安排了协调会。继续推进前，需要参加协调并提交你掌握的事实。"
        )
    if s.stress >= 80 and "exhaustion" not in s.flags:
        s.flags.append("exhaustion")
        s.consequences.append("内耗达到80，继续沟通已难以集中注意力。先休整，或选择离开当前环境。")


def npc_evidence(s: GameState, npc: str) -> list[str]:
    public_purchase = "escalate_purchase" in s.flags
    public_rumor = "publish_rumor" in s.flags
    return [
        EVIDENCE[k]["title"] + "：" + EVIDENCE[k]["text"]
        for k in s.evidence
        if k in EVIDENCE
        and (
            EVIDENCE[k]["npc"] == npc
            or (public_purchase and k in {"purchase_timeline", "finance_claim"})
            or (public_rumor and k in {"rumor_fragment", "meeting_context"})
        )
    ]


def read_model(s: GameState) -> dict[str, Any]:
    return {
        "actions": [
            {
                "action": a,
                "label": v[1],
                "target": v[2],
                "blocked": unavailable(s, a),
                "decision": a in DECISIONS,
                "tradeoff": TRADEOFFS.get(a, ""),
            }
            for a, v in RULES.items()
            if s.act in {2, 3} and v[0] in {0, s.act}
        ],
        "records": [
            {"id": k, "title": EVIDENCE[k]["title"], "text": EVIDENCE[k]["text"]}
            for k in s.evidence
            if k in EVIDENCE
        ],
    }


TRADEOFFS = {
    "settle_purchase": "降低当下冲突，保留日志与时限；不会自动认定责任，也不代表孙淼悔改。舆论 -5，内耗 -5。",
    "escalate_purchase": "请张工核查延误、明确责任；孙淼戒心上升，更多人关注冲突。舆论 +30，内耗 +10。",
    "resolve_rumor": "先在相关人员中纠正，降低扩散；外围同事可能仍未看到更正。舆论 -10，内耗 -5。",
    "publish_rumor": "让完整纪要进入公开记录；澄清范围更大，也会引来更多讨论。舆论 +30，内耗 +10。",
}
