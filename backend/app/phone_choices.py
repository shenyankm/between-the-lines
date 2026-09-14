"""Read-only choice evidence from sent phone messages, not business completion."""

import re


def phone_choice(text: str, channel: str, npc: str) -> str | None:
    """Recognize explicit act-three choices; ambiguous prose remains unselected."""
    if re.search(
        r'[“”"「」『』]|如果|假如|假设|比如|引用|转述|她说|他说|上次|以前|'
        r"不打算|不想|不是要|不是说|不认为|不确定|先别|算了|或者|要不要|这句话|打算|准备|稍后|之后|明天",
        text,
    ):
        return None
    if channel == "group":
        # A statement actually published to the group, not a promise to clarify later.
        if re.search(r"准备澄清|打算澄清|之后澄清|稍后澄清|不要澄清", text):
            return None
        if re.search(
            r"(我没有|我并没有|我没|我并未|我未).{0,8}(跳槽|离职)|"
            r"(跳槽|离职).{0,8}(不是事实|不属实|没有依据)|"
            r"(去留|离职|跳槽).{0,12}以我.{0,8}(说明|表达|通知)为准",
            text,
        ):
            return "clarify"
    if channel == "dm" and npc == "zhang":
        if re.search(
            r"(不|不要|暂不|不用|没有|尚未|并未|没|将|会|想|要).{0,4}(同步|汇报|告知)", text
        ):
            return None
        if re.search(r"吗|？|\?|请确认|请核对|你觉得", text):
            return None
        if re.search(
            r"(同步|汇报|告知).{0,40}(项目|进度|节点|交付|风险|延误)|"
            r"(项目|交付|节点|排期|进度).{0,12}(目前|已经|已完成|正在|按计划)",
            text,
        ):
            return "report"
    if channel == "dm" and npc == "li":
        if re.search(r"(不|不要|暂不|不用|没有|尚未|并未|没).{0,4}(确认|核对|查|问)", text):
            return None
        if re.search(
            r"(谣言|传言|跳槽.{0,4}(消息|说法)).{0,24}(谁|哪里|来源|传出)|"
            r"(谁|哪里).{0,12}(传出|说).{0,12}(谣言|传言|跳槽)",
            text,
        ):
            return "trace_rumor"
    return None


RUMOR_CHOICES = {"clarify", "report", "trace_rumor"}
_CHOICE_FLAGS = {
    "clarification_sent": "clarify",
    "reported:act_3": "report",
    "rumor_verified": "trace_rumor",
}


def selected_rumor_choice(flags: list[str]) -> str | None:
    """Keep the first choice; legacy multi-action saves retain all original facts."""
    for flag in flags:
        if flag.startswith("rumor_choice:") and flag.split(":", 1)[1] in RUMOR_CHOICES:
            return flag.split(":", 1)[1]
    return next((_CHOICE_FLAGS[flag] for flag in flags if flag in _CHOICE_FLAGS), None)
