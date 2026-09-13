"""Conservative evidence gate, applied only to the current player message.

A model chooses a finite intention; major prose can only create a proposal,
never commit a public or private relationship decision. Ambiguity intentionally falls back to buttons.
"""

import re

PATTERNS = {
    "boundary": (
        "sun",
        1,
        r"(请别|请不要|不要|别再|停止).{0,16}(定义|评价|揣测|替我|情绪|感受)|我(需要|决定|要|明确).{0,6}(表达|说明|说清).{0,6}边界|我不接受",
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
    if act != stage or npc not in ({"sun", "li"} if target == "finance" else {target}):
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
