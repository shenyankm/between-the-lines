"""Application-owned inputs to the model adapter."""

from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, Field

from .actions import AvailableAction
from .game_types import VisibleState
from .schemas import GameEventData, TurnInput


@dataclass(frozen=True)
class AgentTurn:
    id: str
    user_id: str
    save_id: str
    input: TurnInput


class AgentContext(BaseModel):
    facts: VisibleState
    history: list[GameEventData]
    checkpoint_namespace: str = ""
    story_version: int = 1
    available_actions: list[AvailableAction] = Field(default_factory=list)


class GameTools(Protocol):
    async def context_for(self, turn: AgentTurn) -> AgentContext: ...
    async def player_intent(
        self, turn_id: str, npc: str, action: str, evidence: str = ""
    ) -> str: ...
    async def npc_operation(self, turn_id: str, npc: str, operation: str) -> str: ...
