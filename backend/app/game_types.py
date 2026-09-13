"""Shared game vocabulary; no HTTP, storage or model dependencies."""

from typing import Literal, TypedDict

from pydantic import BaseModel, Field

Npc = Literal["sun", "li", "zhang"]
Action = Literal[
    "speak",
    "begin",
    "contact_wang",
    "boundary",
    "public_confront",
    "next",
    "supplement",
    "report",
    "clarify",
    "deliver",
    "cut_ties",
    "keep_distance",
    "leave",
    "epilogue",
    "request_materials",
    "approve_purchase",
    "support_project",
    "verify_notice",
    "joint_review",
    "partner_breakup",
    "partner_distance",
    "propose",
    "cancel_proposal",
]


class GameState(BaseModel):
    act: int = Field(ge=0, le=4)
    credit: int = Field(ge=0, le=100)
    stress: int = Field(ge=0, le=100)
    heat: int = Field(ge=0, le=100)
    flags: list[str]
    procurement: Literal["pending", "approved"]
    ending: str | None


Operation = Literal["request_materials", "approve_purchase", "support_project"]
TurnStatus = Literal["running", "completed", "failed"]


class VisibleState(TypedDict):
    act: int
    procurement: Literal["pending", "approved"]
    flags: list[str]


class GameStateV2(GameState):
    story_version: Literal[2] = 2
    node: str = "prologue"
    partner_choice: Literal["breakup", "distance"] | None = None
    ending_id: str | None = None


def parse_state(value: dict[str, object]) -> GameState:
    return (GameStateV2 if value.get("story_version") == 2 else GameState).model_validate(value)
