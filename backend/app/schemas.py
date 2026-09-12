from typing import Any, Literal
from uuid import UUID

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


class TurnInput(BaseModel):
    request_id: UUID
    version: int = Field(ge=0)
    npc: Npc = "sun"
    action: Action = "speak"
    text: str = Field(default="", max_length=1500)


class GameState(BaseModel):
    act: int = Field(ge=0, le=4)
    credit: int = Field(ge=0, le=100)
    stress: int = Field(ge=0, le=100)
    heat: int = Field(ge=0, le=100)
    flags: list[str]
    procurement: Literal["pending", "approved"]
    ending: str | None


class SaveOut(BaseModel):
    id: str
    version: int
    state: GameState


class UserOut(BaseModel):
    id: str
    name: str


class DevLogin(BaseModel):
    name: str = Field(default="试玩者", min_length=1, max_length=40)


class TurnOut(BaseModel):
    id: str
    status: str
    result: dict[str, Any] | None
    usage: dict[str, Any]
