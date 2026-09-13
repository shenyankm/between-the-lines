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
    "repair",
    "written_record",
    "document_rumor",
    "ask_sun",
    "ask_li",
    "audit_purchase",
    "confide_sun",
    "settle_purchase",
    "escalate_purchase",
    "trace_rumor",
    "ask_zhang",
    "interview_sun",
    "resolve_rumor",
    "publish_rumor",
    "attend_review",
    "take_break",
]


class Decision(BaseModel):
    act: int
    action: str
    reason: str
    evidence: list[str]


class Trust(BaseModel):
    sun: int = Field(default=45, ge=0, le=100)
    li: int = Field(default=45, ge=0, le=100)
    zhang: int = Field(default=45, ge=0, le=100)


class GameState(BaseModel):
    act: int = Field(ge=0, le=4)
    credit: int = Field(ge=0, le=100)
    stress: int = Field(ge=0, le=100)
    heat: int = Field(ge=0, le=100)
    flags: list[str]
    procurement: Literal["pending", "approved"]
    ending: str | None
    consequences: list[str] = Field(default_factory=list)
    trust: Trust = Field(default_factory=Trust)
    evidence: list[str] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)


Operation = Literal["request_materials", "approve_purchase", "support_project"]
TurnStatus = Literal["running", "completed", "failed"]


class VisibleState(TypedDict):
    act: int
    procurement: Literal["pending", "approved"]
    flags: list[str]
