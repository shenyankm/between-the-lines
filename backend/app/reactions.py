"""Authored, state-aware responses to finite story actions; no network wait."""

from .game_types import GameState


def action_reply(action: str, state: GameState) -> str:
    from .investigation import RULES

    if action in RULES:
        evidence = RULES[action][3]
        if evidence:
            return {
                "ask_sun": "菱菱，加急也得按流程呀。你这单的依据一直不合适，我替你把关，怎么还成我卡你了？",
                "ask_li": "先别急着争。我的收件时间是周二10:20，加急依据要填正式表格；前面两天还没到我这儿。报价单、用途说明、加急依据齐全，我就按规则审核。",
                "audit_purchase": "日志给你核对。附件周五已上传，周一在待转交，周二才到我这里。格式问题归格式问题，耽误在哪一步要分清。",
                "confide_sun": "我先放着也是替你把关嘛。菱菱，我们这么熟，你怎么连这点时间都要计较？表格填好不就行了。",
                "trace_rumor": "群里那句话你也看到了？菱菱，大家关心一下，你别又多想。",
                "ask_zhang": "纪要在这里，谈的是换合作实验室。实验地点和个人去留，怎么能混为一谈？拿这段核对。",
                "interview_sun": "我是提过你说要换地方，还不是关心你。我就随口聊两句，你现在非要一字一句对着查吗？",
            }[action]
        return {
            "settle_purchase": "菱菱，我也是替你把关，你怎么弄得这么生分。好吧，转交时间就照你写的来。",
            "escalate_purchase": "记录给我。附件格式和转交延误分开核对，哪个节点停了多久，写清楚。不能拿流程挡研发。",
            "resolve_rumor": "我会向相关人员纠正。你保留纪要，继续做项目；传言不能拿来评价工作。",
            "publish_rumor": "纪要已经说明，讨论的是实验地点，不是个人跳槽。停止传言，回到研发结果。",
            "attend_review": "记录能对应上。按事实处理，明确每个环节的责任。"
            if "review_supported" in state.flags
            else "现有记录还不能确认责任。先停下猜测，把时间和依据补清楚。",
            "take_break": "先缓一缓。记录留着，事情可以一件件处理。",
        }[action]
    flags = set(state.flags)
    replies = {
        "boundary": "菱菱，我不是关心你嘛。好，以后就说工作，你可别又觉得我生分。",
        "public_confront": "菱菱，一点小事一定要当着大家说吗？我也是为你好。工作的事当然按流程来。",
        "repair": "我就说我们这么熟，何必闹得难看。好，工作直接说，你也别把每句话都往心里去。",
        "written_record": "记录收到了，咱们对着时间核一下。材料齐全就该按规则过，不用先跟谁赔不是。",
        "supplement": "材料收到了。我来核对，该过的单子就过，不把你们的私下关系带进审核。",
        "report": "风险我知道了。你需要我协调实验排期的话，直接说，我来落实支持。",
        "clarify": "这件事在例会上说清了。传言先到这里，接下来我们看项目结果。",
        "document_rumor": "证据先留好，我私下核实。这之前，例会上先不扩大讨论。",
        "deliver": "结果和调整后的计划收到了。错过的实验窗口要重新安排，后面有变动及时同步。"
        if "schedule_delayed" in flags
        else "结果与计划收到了。实验窗口已经保留，接下来按这个安排推进。"
        if "schedule_protected" in flags
        else "结果与计划收到了。后续按这个安排走，有变动及时同步。",
    }
    return replies[action]
