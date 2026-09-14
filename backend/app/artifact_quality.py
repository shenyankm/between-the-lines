"""Bounded source selection and role context for read-only AI artifacts."""

import re
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urlsplit

from .db import Event
from .story_rules import CATALOG

STRATEGIES = {
    "direct": "直接沟通",
    "process": "流程协作",
    "observe": "暂缓观察",
}

# These buttons advance/read a result; clicking them is not an in-story statement.
RESULT_ACTIONS = {
    "begin",
    "next",
    "close_story",
    "project_review",
    "review_clarification",
    "review_support",
    "complete_remedy",
    "request_help",
}


class ArtifactQualityError(ValueError):
    """Only static reason codes may be logged or sent to a repair prompt."""


def normalized(text: str) -> str:
    return re.sub(r"[\W_]+", "", text).casefold()


def diverse_sources(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    seen_text: set[str] = set()
    groups: set[str] = set()
    first: list[dict[str, Any]] = []
    remaining: list[dict[str, Any]] = []
    for row in rows:
        url = urlsplit(row["url"])
        canonical = (url.hostname or "").removeprefix("www.") + url.path.rstrip("/")
        content = normalized(row["summary"])
        if row["id"] in seen_ids or canonical in seen_urls or content in seen_text:
            continue
        seen_ids.add(row["id"])
        seen_urls.add(canonical)
        seen_text.add(content)
        # Different answers to one question are retained after other questions.
        match = re.search(r"/question/(\d+)", url.path)
        group = match.group(0) if match else canonical
        (remaining if group in groups else first).append(row)
        groups.add(group)
    return (first + remaining)[:6]


def role_context(event: Event) -> dict[str, str]:
    data = event.data
    action = data.get("action")
    kind = data.get("kind")
    player = kind == "player" and action in {*CATALOG, "speak"} - RESULT_ACTIONS
    # NPC-triggered system outcomes must not be presented as player statements.
    return {
        "actor": "player" if player else "npc" if kind == "npc" else "unknown",
        "player_name": "周菱菱",
        "action": action if isinstance(action, str) else "unknown",
        "player_action": CATALOG[action][0]
        if player and action in CATALOG
        else "玩家亲自表达"
        if player
        else "无明确玩家表达或行动，仅查看结果",
        "channel": data.get("channel", "unknown"),
        "counterpart": data.get("npc", "unknown"),
        "player_role": "rumor_subject" if data.get("act") == 3 else "employee",
        "description": "玩家是被议论的研发专员，其他同事才是消息转述者。"
        if data.get("act") == 3
        else "玩家是面对同事和审批流程的研发专员，没有审批或替他人决定的权限。",
    }


def validate_advice(fact: dict[str, Any], text: str) -> None:
    context = fact.get("role_context", {})
    if context.get("actor") != "player":
        raise ArtifactQualityError("reflection_actor_unknown")
    if re.search(r"(?:^|[：:‘“\"，,])(?:周)?菱菱[，,：:]", text) or re.search(
        r"我.{0,4}(?:不替你决定|替你决定|尊重你的选择)", text
    ):
        raise ArtifactQualityError("reflection_speaks_as_npc_to_player")
    if context.get("action") in {"speak", "boundary", "join_farewell", "follow_up"} and re.search(
        r"(?:问|确认).{0,6}(?:孙淼|同事|对方).{0,6}(?:是否愿意|愿不愿意|是否参加|参不参加|要不要参加)|"
        r"替(?:他|她|对方).{0,8}(?:回话|回复|决定|报名)",
        text,
    ):
        raise ArtifactQualityError("reflection_swaps_participation_owner")
    if context.get("player_role") == "rumor_subject" and re.search(
        r"(?:在|你|自己|应当|应该|可以|建议).{0,12}(?:转述|传播|转发).{0,6}(?:前|之前|消息时)|"
        r"(?:向|找).{0,5}当事人.{0,6}(?:核实|确认)|"
        r"(?:你|自己).{0,8}(?:不该|不应|停止|不要).{0,6}(?:造谣|传谣|传播谣言)",
        text,
    ):
        raise ArtifactQualityError("reflection_confuses_rumor_subject_with_spreader")
    if re.search(
        r"(?:建议|可以|不妨|应该)(?:让)?(?:孙淼|李姐|张工).{0,8}(?:主动|直接)?(?:承认|道歉|批准|审批)",
        text,
    ):
        raise ArtifactQualityError("reflection_assigns_other_actor_decision")


def repeated_text(texts: list[str], candidate: str) -> bool:
    value = normalized(candidate)
    return any(SequenceMatcher(None, normalized(text), value).ratio() >= 0.86 for text in texts)
