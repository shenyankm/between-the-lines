"""Project current ending facts without rewriting the saved event history."""

import re
from typing import Any


class EndingFactError(ValueError):
    """A fixed diagnostic identifier; never contains player or generated text."""


def current_ending_facts(state: dict[str, Any]) -> dict[str, Any]:
    work = dict(state.get("work", {}).get("facts", {}))
    relationship = dict(state.get("relationship", {}).get("facts", {}))
    # These pending descriptions cease to be current when their response arrives.
    for completed, pending, facts in (
        ("friendship", "friendship_offer", relationship),
        ("rules_changed", "rules_proposed", work),
    ):
        if completed in facts:
            facts.pop(pending, None)
    intention = state.get("relationship", {}).get("intention", "undecided")
    if intention != "professional":
        relationship.pop("sun_cut", None)
    if intention != "undecided":
        relationship.pop("sun_observe", None)
    return {"work": work, "relationship": relationship}


def validate_ending_prose(text: str, payload: dict[str, Any]) -> None:
    """Reject explicit denials of recorded milestones, not arbitrary prose semantics.

    Historical dialogue remains available for callbacks, but pending-stage wording
    must not be reused as the ending's present state. Failure uses the existing
    two-attempt generation budget and then the saved-fact fallback.
    """
    facts = payload.get("confirmed_facts", {})
    relationship = facts.get("relationship", {})
    missing = r"(?:尚未|仍未|还未|还没(?:有)?|没有|未曾|不曾)"
    subject = r"(?:孙淼|对方|她|双方)[^。！？\n，,；;]{0,12}"
    checks = {
        "friendship": subject
        + missing
        + r"(?:作出|做出|给出|明确)?(?:回应|答复|表态|同意修复|同意保留友谊)",
        "harm": subject + missing + r"(?:明确|具体)?承认(?:.{0,6})(?:伤害|错误|过错)",
        "remedy": subject + missing + r"(?:进行|做出|完成|落实)?(?:实际|具体|有效)?补救",
        "follow_up": subject + missing + r"(?:在后续协作中)?尊重(?:你的|玩家的)?边界",
    }
    for milestone, pattern in checks.items():
        if milestone in relationship and re.search(pattern, text):
            raise EndingFactError(
                f"Ending contradicts confirmed relationship milestone: {milestone}"
            )
    if "farewell_attended" in facts.get("work", {}) and re.search(
        r"(?:错过|未能参加|没能参加|没有参加|未参加).{0,8}欢送会", text
    ):
        raise EndingFactError("Ending contradicts confirmed farewell attendance")
