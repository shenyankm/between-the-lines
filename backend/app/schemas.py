from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .error_catalog import ErrorCode, FailureCode, Recovery, failure_message
from .game_types import Action, GameState, Npc, TurnStatus
from .story import Relationship, load_story


class TurnInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    version: int = Field(ge=0, strict=True)
    npc: Npc = "sun"
    action: Action = "speak"
    text: str = Field(default="", max_length=1500)


class SaveOut(BaseModel):
    id: str
    version: int
    state: GameState
    relationships: list[Relationship] = Field(default_factory=list)
    ending_summary: str | None = None
    npc_greetings: dict[Npc, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def narrative_projection(self) -> "SaveOut":
        story = load_story()
        self.relationships = story.relationships_for(self.state)
        self.ending_summary = story.ending_summary(self.state)
        self.npc_greetings = {
            npc: story.greeting_for(npc, self.state.act, self.state.flags) for npc in story.npcs
        }
        return self


class UserOut(BaseModel):
    id: str
    name: str


class DevLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="试玩者", min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name must not be blank")
        return value.strip()


class LogoutOut(BaseModel):
    ok: bool


class TurnUsage(BaseModel):
    model: str | None = None
    mode: Literal["mock", "deepseek"] | None = None
    model_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    cost_estimate_usd: float = 0.0
    billing_complete: bool = False


class TurnFailure(BaseModel):
    code: FailureCode
    message: str
    request_id: str | None = None
    recovery: Literal["refresh"] = "refresh"


class StreamErrorEvent(BaseModel):
    code: Literal["subscription_failed"] = "subscription_failed"
    message: str = "回复连接已中断，请恢复回合结果。"
    request_id: str
    turn_id: str
    recovery: Literal["recover"] = "recover"


class TurnResult(BaseModel):
    turn_id: str
    status: Literal["completed", "failed"]
    text: str | None = None
    save: SaveOut
    retryable: bool = False
    failure: TurnFailure | None = None

    @model_validator(mode="after")
    def legacy_failure(self) -> "TurnResult":
        if self.status == "failed" and self.failure is None:
            self.failure = TurnFailure(
                code=FailureCode.UNKNOWN, message=failure_message(FailureCode.UNKNOWN)
            )
        if self.status == "completed" and self.failure is not None:
            raise ValueError("Completed turns cannot carry a failure")
        return self


class GameEventData(BaseModel):
    kind: Literal["player", "npc", "work", "epilogue", "personal"]
    text: str
    npc: Npc
    act: int | None = None
    action: Action | None = None


class GameEventOut(GameEventData):
    id: str


class ActiveTurn(BaseModel):
    id: str
    request_id: str


class PlayStateOut(BaseModel):
    save: SaveOut
    events: list[GameEventOut]
    active_turn: ActiveTurn | None


class ConfigOut(BaseModel):
    dev_login: bool
    zhihu_login: bool
    agent_mode: Literal["mock", "deepseek"]
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


class FieldIssue(BaseModel):
    field: str
    code: str
    message: str


class ErrorBody(BaseModel):
    # A stable snake_case identifier clients may branch on. `message` is prose for
    # a human and may be reworded; `code` may not.
    code: ErrorCode
    message: str
    request_id: str
    recovery: Recovery
    details: list[FieldIssue] | None = None
    retry_after_seconds: int | None = Field(default=None, ge=0)


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
