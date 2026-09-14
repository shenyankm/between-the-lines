"""Whole-utterance shortcuts; permissions and facts still come from GameService."""

from .story_rules import CATALOG


def fast_work_operation(text: str, npc: str, act: int) -> str | None:
    if act not in {2, 3}:
        return None
    utterance = text.strip().rstrip("。！？!?")
    phrases = {
        "request_materials": {"采购需要哪些材料", "请列出采购材料要求", "请明确缺少哪些材料"},
        "approve_purchase": {"请审核采购", "材料齐了请审核采购"},
        "support_project": {"请协调实验排期", "请支持项目", "请落实实验排期支持"},
    }
    for action, aliases in phrases.items():
        label, acts, target, _, _ = CATALOG[action]
        allowed = npc in {"sun", "li"} if action == "request_materials" else npc == target
        if allowed and act in acts and utterance in aliases | {label.rstrip("。！？!?")}:
            return action
    return None
