"""Exact, unambiguous work requests; all other speech stays with the NPC model."""

import re

from .game_types import Operation

REQUESTS: dict[Operation, frozenset[str]] = {
    "request_materials": frozenset(
        {
            "请列出采购材料要求",
            "采购需要哪些材料",
            "需要哪些材料",
            "缺少哪些材料",
            "请明确缺少哪些材料",
            "请明确缺少哪些采购材料",
            "请问采购缺少哪些材料",
        }
    ),
    "approve_purchase": frozenset(
        {
            "请审核采购",
            "请审核这笔采购",
            "材料齐了请审核采购",
            "材料已补齐请审核采购",
            "材料齐全请审核",
            "报价用途和加急依据已补齐请按记录审核",
        }
    ),
    "support_project": frozenset(
        {
            "请落实实验排期支持",
            "请协调实验排期",
            "请支持项目",
            "请落实项目支持",
        }
    ),
}


def work_request(text: str, npc: str, act: int) -> Operation | None:
    if act != 2:
        return None
    # Whole-utterance allowlist: quoted, conditional, negated and mixed-intent
    # statements cannot accidentally execute a work operation.
    normalized = re.sub(r"[\s，,。.!！?？]", "", text)
    for operation, phrases in REQUESTS.items():
        if normalized not in phrases:
            continue
        if operation == "request_materials" and npc in {"sun", "li"}:
            return operation
        if operation == "approve_purchase" and npc == "li":
            return operation
        if operation == "support_project" and npc == "zhang":
            return operation
    return None


def work_reply(npc: str, operation: Operation, result: str) -> str:
    if operation == "request_materials":
        return (
            "菱菱，报价单、用途说明、加急依据都要齐。我已经把要求登记了，可别又说我卡你。"
            if npc == "sun"
            else "报价单、用途说明、加急依据。我已经登记好要求，补齐后就按规则审核。"
        )
    # Use the committed rule result, never an optimistic success message.
    return result
