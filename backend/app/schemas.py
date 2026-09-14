from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .actions import AvailableAction
from .error_catalog import ErrorCode, FailureCode, Recovery, failure_message
from .game_types import (
    Action,
    Channel,
    GameState,
    GameStateV2,
    GameStateV3,
    Npc,
    TurnStatus,
    parse_state,
)
from .story import Relationship, SceneLine, load_story


class ActionParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: str | None = Field(default=None, min_length=1, max_length=1000)
    evidence: list[Literal["quote", "purpose", "urgency"]] | None = Field(
        default=None, max_length=3
    )
    purchase_kind: Literal["standard", "urgent"] | None = None
    support_kind: Literal["leave", "help"] | None = None
    plan: str | None = Field(default=None, min_length=1, max_length=1000)
    boundary_response: Literal["decline", "agree", "ask_details"] | None = None
    kind: Literal["resign", "transfer", "withdraw"] | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=1000)


class TurnInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    version: int = Field(ge=0, strict=True)
    npc: Npc = "sun"
    action: Action = "speak"
    text: str = Field(default="", max_length=1500)
    channel: Channel | None = None
    target: Literal["sun", "li", "zhang", "wang", "group"] | None = None
    params: ActionParameters | None = None
    proposed_action: Action | None = None
    proposal_id: UUID | None = None
    discussion_id: UUID | None = None
    perspective_id: str | None = Field(default=None, max_length=40)

    def canonical_payload(self) -> dict[str, Any]:
        value = self.model_dump(mode="json")
        return {
            k: v
            for k, v in value.items()
            if k in {"request_id", "version", "npc", "action", "text"} or v is not None
        }


class SaveOut(BaseModel):
    id: str
    version: int
    state: GameStateV3 | GameStateV2 | GameState
    read_only: bool = False
    story_id: str = "workplace-s1"
    story_version: int = 1
    last_played_at: datetime | None = None
    parent_save_id: str | None = None
    archived_at: datetime | None = None
    deleted_at: datetime | None = None

    @field_validator("state", mode="before")
    @classmethod
    def state_version(cls, value: Any) -> GameState:
        return parse_state(value) if isinstance(value, dict) else value

    relationships: list[Relationship] = Field(default_factory=list)
    scene_intro: str | None = None
    ending_summary: str | None = None
    npc_greetings: dict[Npc, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def narrative_projection(self) -> "SaveOut":
        self.read_only = self.story_version < 3 or getattr(self.state, "content_revision", 1) < 2
        story = load_story(self.story_version, getattr(self.state, "content_revision", 1))
        self.relationships = story.relationships_for(self.state)
        self.ending_summary = story.ending_summary(self.state)
        self.scene_intro = story.scene_intro(self.state)
        self.npc_greetings = {
            npc: story.greeting_for(npc, self.state.act, self.state.flags) for npc in story.npcs
        }
        return self


class UserOut(BaseModel):
    id: str
    name: str
    can_play: bool
    identity_type: str = "member"
    guest_expires_at: datetime | None = None
    binding_pending: bool = False


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
    effects: list[dict[str, Any]] = Field(default_factory=list)
    proposal: dict[str, Any] | None = None

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
    effects: list[dict[str, Any]] = Field(default_factory=list)
    kind: Literal["player", "npc", "work", "epilogue", "personal", "narrative"]
    text: str
    npc: Npc
    speaker: str | None = None
    channel: Channel = "scene"
    audience: list[str] = Field(default_factory=list)
    scene: str | None = None
    act: int | None = None
    action: Action | None = None


class GameEventOut(GameEventData):
    id: str


class ActiveTurn(BaseModel):
    id: str
    request_id: str


class ProposalOut(BaseModel):
    id: str
    action: Action
    version: int
    label: str
    effect: str


class AIAvailability(BaseModel):
    available: bool = True
    reason: str | None = None


class ContactOut(BaseModel):
    preview: str = ""
    count: int = 0
    unread: bool = False


class PlayStateOut(BaseModel):
    performance: list[SceneLine] = Field(default_factory=list)
    performance_version: int | None = None
    contacts: dict[str, ContactOut] = Field(default_factory=dict)
    reading: dict[str, int] = Field(default_factory=dict)
    save: SaveOut
    events: list[GameEventOut]
    active_turn: ActiveTurn | None
    available_actions: list[AvailableAction] = Field(default_factory=list)
    proposal: ProposalOut | None = None
    events_cursor: str | None = None
    ai: AIAvailability = Field(default_factory=AIAvailability)


class ConfigOut(BaseModel):
    dev_login: bool
    zhihu_login: bool
    agent_mode: Literal["mock", "deepseek"]
    model_ready: bool
    guest_login: bool = False
    story_version: int = 1


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


class CreateSaveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    story_version: Literal[1, 2, 3] | None = None


class SaveManagement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["archive", "unarchive", "delete", "restore"]


class BranchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    snapshot_id: UUID


class JobInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    kind: Literal["reflection", "discussion", "ending"]
    version: int = Field(ge=0)


class JobOut(BaseModel):
    act: int | None = None
    id: str
    kind: str
    status: str
    result: dict[str, Any] | None = None


class SnapshotOut(BaseModel):
    id: str
    node: str
    created_at: datetime


class DiagnosticInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["render", "uncaught", "rejection", "query"]
    code: str | None = Field(default=None, max_length=80, pattern=r"^[a-z_]+$")
    request_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    build: str = Field(default="unknown", max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    stack: str | None = Field(default=None, max_length=2000)


class FeedbackInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1500)


class ProductEventInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal["recap_viewed", "recovery_completed", "recovery_failed", "approval_stuck"]
