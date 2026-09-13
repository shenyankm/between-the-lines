"""Shared game vocabulary; no HTTP, storage or model dependencies."""

from typing import Literal, TypedDict

from pydantic import BaseModel, Field

Npc = Literal["sun", "li", "zhang", "wang"]
Action = Literal[
    "speak",
    "begin",
    "contact_wang",
    "join_farewell",
    "attend_farewell",
    "boundary",
    "public_confront",
    "next",
    "supplement",
    "report",
    "clarify",
    "review_clarification",
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
    "submit_purchase",
    "dispute_return",
    "trace_rumor",
    "confirm_responsibility",
    "change_rules",
    "apply_rules",
    "repair_friendship",
    "acknowledge_harm",
    "complete_remedy",
    "follow_up",
    "partner_undecided",
    "draft_support",
    "submit_support",
    "review_support",
    "rest",
    "request_help",
    "appease",
    "request_extension",
    "project_review",
    "correct_loss",
    "draft_exit",
    "submit_exit",
    "close_story",
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
    cls: type[GameState] = (
        GameStateV3
        if value.get("story_version") == 3
        else GameStateV2
        if value.get("story_version") == 2
        else GameState
    )
    return cls.model_validate(value)


Channel = Literal["scene", "dm", "group", "work"]
EndingId = Literal[
    "active_exit",
    "career_cost",
    "rules_rewritten",
    "limited_repair",
    "professional_boundary",
    "unresolved",
]


class Fact(BaseModel):
    event_id: str
    detail: str


class Submission(BaseModel):
    event_id: str
    version: int
    purpose: str
    evidence: list[str]
    status: Literal["returned", "resubmitted", "approved"]
    feedback: str = ""


class ReviewRecord(BaseModel):
    event_id: str
    version: int
    actor: Npc
    decision: str
    detail: str
    time: str


class WorkState(BaseModel):
    purchase: Literal["pending", "returned", "review", "approved"] = "pending"
    submissions: list[Submission] = Field(default_factory=list)
    reviews: list[ReviewRecord] = Field(default_factory=list)
    facts: dict[str, Fact] = Field(default_factory=dict)


class RelationState(BaseModel):
    intention: Literal["undecided", "friendship", "professional"] = "undecided"
    facts: dict[str, Fact] = Field(default_factory=dict)


class ExitDraft(BaseModel):
    kind: Literal["resign", "transfer", "withdraw"]
    reason: str = Field(min_length=1, max_length=1000)
    event_id: str
    submitted: bool = False


class EndingResult(BaseModel):
    id: EndingId
    title: str
    achievements: list[str]
    unresolved: list[str]
    key_event_ids: list[str]


class SupportApplication(BaseModel):
    kind: Literal["leave", "help"]
    reason: str = Field(min_length=1, max_length=1000)
    plan: str = Field(min_length=1, max_length=1000)
    act: int
    draft: Fact
    submitted: Fact | None = None
    approval: Fact | None = None
    completion: Fact | None = None


class GameStateV3(GameState):
    story_version: Literal[3] = 3
    content_revision: Literal[1, 2] = 1
    support_requests: list[SupportApplication] = Field(default_factory=list)
    node: str = "prologue"
    tick: int = 0
    rumination: int = Field(default=25, ge=0, le=100)
    pressure: int = Field(default=25, ge=0, le=100)
    work: WorkState = Field(default_factory=WorkState)
    relationship: RelationState = Field(default_factory=RelationState)
    partner_choice: Literal["breakup", "distance", "undecided"] | None = None
    exit_draft: ExitDraft | None = None
    outcome: EndingResult | None = None
    scored: list[str] = Field(default_factory=list)
    quiet_turns: int = 0


def initial_v3() -> GameStateV3:
    return GameStateV3(
        content_revision=2,
        act=0,
        credit=50,
        stress=25,
        heat=10,
        flags=[],
        procurement="pending",
        ending=None,
    )
