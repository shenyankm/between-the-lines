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
    "leave",
    "epilogue",
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
