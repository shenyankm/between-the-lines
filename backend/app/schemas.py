from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from .game_types import Action, GameState, Npc, TurnStatus


class TurnInput(BaseModel):
    request_id: UUID
    version: int = Field(ge=0)
    npc: Npc = "sun"
    action: Action = "speak"
    text: str = Field(default="", max_length=1500)


class SaveOut(BaseModel):
    id: str
    version: int
    state: GameState


class UserOut(BaseModel):
    id: str
    name: str


class DevLogin(BaseModel):
    name: str = Field(default="试玩者", min_length=1, max_length=40)


class TurnUsage(BaseModel):
    model: str | None = None
    mode: Literal["mock", "deepseek", "openai"] | None = None
    model_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    first_response_ms: int | None = None
    cost_estimate_usd: float | None = 0.0
    billing_complete: bool = False


class TurnResult(BaseModel):
    turn_id: str
    status: Literal["completed", "failed"]
    text: str | None = None
    save: SaveOut
    retryable: bool = False


class GameEventData(BaseModel):
    kind: Literal["player", "npc", "work", "epilogue", "suggestion", "memory"]
    text: str
    npc: Npc
    act: int | None = None
    action: Action | None = None


class GameEventOut(GameEventData):
    id: str


class ActiveTurn(BaseModel):
    id: str
    request_id: str


class InvestigationAction(BaseModel):
    action: Action
    label: str
    target: Npc
    blocked: str
    decision: bool
    tradeoff: str


class EvidenceOut(BaseModel):
    id: str
    title: str
    text: str


class InvestigationOut(BaseModel):
    actions: list[InvestigationAction] = Field(default_factory=list)
    records: list[EvidenceOut] = Field(default_factory=list)


class PlayStateOut(BaseModel):
    investigation: InvestigationOut = Field(default_factory=InvestigationOut)
    save: SaveOut
    events: list[GameEventOut]
    active_turn: ActiveTurn | None


class ConfigOut(BaseModel):
    dev_login: bool
    zhihu_login: bool
    agent_mode: Literal["mock", "deepseek", "openai"]
    model_ready: bool


class StatusEvent(BaseModel):
    turn_id: str
    text: str


class DialogueEvent(BaseModel):
    npc: Npc
    text: str


class TurnOut(BaseModel):
    id: str
    status: TurnStatus
    result: TurnResult | None
    usage: TurnUsage


class ErrorBody(BaseModel):
    # A stable snake_case identifier clients may branch on. `message` is prose for
    # a human and may be reworded; `code` may not.
    code: str
    message: str
    request_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorBody


class LiveOut(BaseModel):
    status: Literal["alive"] = "alive"


class ReadyOut(BaseModel):
    status: Literal["ready", "not_ready"]
    # Constrained to two values on purpose: a readiness probe that reported the
    # underlying exception would turn a dependency's error string into a public
    # response body. Details go to the log.
    checks: dict[str, Literal["ok", "error"]]
