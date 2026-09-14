"""Conservative evidence gate, applied only to the current player message.

A model chooses a finite intention; major prose can only create a proposal,
never commit a public or private relationship decision. Ambiguity intentionally falls back to buttons.
"""

import re

PATTERNS = {
    "boundary": (
        "sun",
        1,
        r"(请别|请不要|不要|别再|停止).{0,16}(定义|评价|揣测|替我|情绪|感受)|我(需要|决定|要|明确).{0,6}(表达|说明|说清).{0,6}边界|我不接受|我不喜欢这种玩笑|既然知道我可能会生气，为什么不直接问我",
    ),
    "report": ("zhang", 2, r"(同步|汇报|告知).{0,40}(风险|延迟|延误|阻碍|进度)"),
    "support_project": ("zhang", 2, r"(请|希望|需要|请求).{0,20}(支持|协调|帮忙)"),
    "approve_purchase": ("li", 2, r"(请|请求|麻烦).{0,16}(审核|审批|核对材料)"),
    "request_materials": (
        "finance",
        2,
        r"(哪些|什么|哪些要求|还缺|需要|确认).{0,20}(材料|报价|用途|依据)|材料.{0,10}(要求|还缺|齐全)",
    ),
}


def grounded(text: str, action: str, npc: str, act: int) -> bool:
    spec = PATTERNS.get(action)
    if not spec:
        return False
    target, stage, pattern = spec
    if (act < stage or act > 3) or npc not in ({"sun", "li"} if target == "finance" else {target}):
        return False
    if re.search(
        r'[“”"「」『』‘’]|如果|假如|假设|举例|比如|他说|她说|引用|转述|以前|上次|不认为|不确定|要不要|是否|不知道|并不|不愿|不是要|不想|不需要|不请求|不打算|无需|暂不|先别|不要帮|不用|或者|还是|一方面|但是|不过|算了',
        text,
    ):
        return False
    if action == "boundary" and re.search(r"吗|你觉得|能否|是否|要不要", text):
        return False
    if action != "boundary" and re.search(
        r"(不要|请别|别再|停止|暂缓|取消).{0,12}(审核|审批|支持|协调|登记|确认|询问|同步|汇报|材料)",
        text,
    ):
        return False
    matched = [key for key, (_, _, candidate) in PATTERNS.items() if re.search(candidate, text)]
    # Reporting risk followed by explicitly asking for support is the sole allowed
    # player/NPC pair. Other compound requests require a deliberate button choice.
    if len(matched) > 1 and set(matched) != {"report", "support_project"}:
        return False
    return bool(re.search(pattern, text))


MAJOR_PATTERNS = {
    "public_confront": r"(我要|我决定|我想).{0,8}(当众|公开).{0,8}质问",
    "cut_ties": r"(我要|我决定|我想).{0,8}(结束|切断).{0,12}(孙淼|私人来往)",
    "keep_distance": r"(我要|我决定|我想).{0,8}保持距离.{0,8}观察",
    "leave": r"(我要|我决定|我想).{0,8}(离开公司|离开当前环境|离职)",
}


def grounded_major(text: str, action: str) -> bool:
    if re.search(
        r'[“”"「」『』‘’]|如果|假设|假如|引用|他说|她说|以前|上次|不想|不打算|不是|或者|但是|算了',
        text,
    ):
        return False
    matches = [key for key, pattern in MAJOR_PATTERNS.items() if re.search(pattern, text)]
    return matches == [action]


def grounded_v3(text: str, action: str, npc: str, act: int) -> bool:
    """Shared catalogue grounding for v3, with whole-utterance ambiguity checks.

    Authored labels are always understood. Additional natural expressions are
    explicit aliases; unknown paraphrases remain conversation rather than facts.
    """
    from .story_rules import CATALOG

    if action not in CATALOG or act not in CATALOG[action][1]:
        return False
    target = CATALOG[action][2]
    if target is not None and target != npc and not (action == "request_materials" and npc == "li"):
        return False
    # These complete utterances state a boundary despite a polite contrast. Keep
    # the general ambiguity gate for every other sentence and compound request.
    if action == "boundary" and re.fullmatch(
        r"(?:我不接受你替我决定[，,]?但是我愿意听你解释|"
        r"我希望你以后先问问我再替我[作做]决定)[。！!]?",
        text.strip(),
    ):
        return True
    if re.search(
        r'[“”"「」『』‘’]|如果|假如|假设|举例|比如|他说|她说|引用|转述|以前|上次|不确定|要不要|是否|不知道|并不|不愿|不是要|不想|不需要|不请求|不打算|无需|暂不提交|先别|不要帮|不用|或者|还是|但是|不过|算了',
        text,
    ):
        return False
    if re.search(
        r"(取消|暂缓|不要|别).{0,8}(提交|申请|参加|澄清|审核|汇报|结束|离职|补充|执行|复核)", text
    ):
        return False
    aliases = {
        "join_farewell": r"(名单.{0,8}(加上|加我)|把我.{0,8}(加进|加入).{0,8}(名单|欢送会))",
        "attend_farewell": r"我(现在|要|决定).{0,6}(去食堂|参加欢送会)",
        "appease": r"没事[，,]?你们继续聊|我先忍一下",
        "boundary": PATTERNS["boundary"][2],
        "report": PATTERNS["report"][2],
        "request_materials": r"(哪些|什么|还缺|缺少|所需).{0,12}(材料|报价|用途|依据)|材料.{0,10}(要求|还缺)|材料.{0,4}齐全[吗？?]|(请|麻烦).{0,6}(说明|列出).{0,6}(缺少|所需).{0,4}材料",
        "approve_purchase": PATTERNS["approve_purchase"][2],
        "support_project": PATTERNS["support_project"][2],
        "dispute_return": r"(复核|核对).{0,10}(退回|退单).{0,8}(依据|理由)|退回.{0,8}(合理吗|合规吗)",
        "clarify": r"(我来|我要|请帮我).{0,8}(群里|工作群).{0,8}澄清",
        "trace_rumor": r"(核对|确认|查一下).{0,12}(谣言|传言).{0,12}(谁|来源|传出)",
        "repair_friendship": r"我(希望|愿意|想).{0,10}(继续做朋友|保留友谊|修复友谊)",
        "cut_ties": r"(只保留|仅保留).{0,6}(工作|职业).{0,4}(关系|往来|沟通)",
        "keep_distance": r"(关系|朋友).{0,8}(暂不决定|先不决定)|我暂时不决定关系",
        "close_story": r"(我想|我要|我决定).{0,6}(结束|收束).{0,4}(本局|这一局|故事)",
        "submit_exit": r"(确认|正式).{0,4}提交.{0,6}(离职|调岗|退出).{0,4}申请",
        "draft_exit": r"(预览|草拟|填写).{0,6}(离职|调岗|退出).{0,4}申请",
    }
    for key, pattern in MAJOR_PATTERNS.items():
        if key != "leave":
            aliases[key] = f"(?:{aliases.get(key, pattern)})|(?:{pattern})"
    if re.search(r"你觉得|是不是|举个例子|这句话|分析一下|解释一下", text):
        return False
    matches = []
    for key, (label, _, _, _, _) in CATALOG.items():
        if key == "leave":  # legacy alias must not create duplicate matches
            continue
        literal = label.rstrip("。？?")
        if literal in text or (key in aliases and re.search(aliases[key], text)):
            matches.append(key)
    return matches == [action]
