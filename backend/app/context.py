"""Application-owned inputs to the model adapter."""

from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, Field

from .game_types import VisibleState
from .schemas import GameEventData, TurnInput


@dataclass(frozen=True)
class AgentTurn:
    id: str
    user_id: str
    save_id: str
    input: TurnInput


class AgentContext(BaseModel):
    relationship: str = ""
    evidence: list[str] = Field(default_factory=list)
    facts: VisibleState
    history: list[GameEventData]
    memories: list[str] = Field(default_factory=list)
    available_actions: dict[str, str] = Field(default_factory=dict)
    consequences: list[str] = Field(default_factory=list)


class GameTools(Protocol):
    async def propose_action(self, turn: AgentTurn, action: str) -> str: ...
    async def remember_player(self, turn: AgentTurn, quote: str) -> str: ...
    async def context_for(self, turn: AgentTurn) -> AgentContext: ...
    async def npc_operation(self, turn_id: str, npc: str, operation: str) -> str: ...
