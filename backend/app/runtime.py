"""Explicit resources; importing this module performs no I/O."""

from dataclasses import dataclass
from typing import Any, cast

from authlib.integrations.starlette_client import OAuth
from fastapi import Request
from langgraph.types import Checkpointer
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .config import Settings
from .metrics import Metrics
from .runner import Epilogue, Reply, TurnRunner
from .services import GameService
from .story import StoryDefinition


@dataclass
class Dependencies:
    reply: Reply | None = None
    epilogue: Epilogue | None = None


@dataclass
class Runtime:
    settings: Settings
    story: StoryDefinition
    sessions: async_sessionmaker[AsyncSession]
    service: GameService
    checkpointer: Checkpointer
    checkpoint_pool: AsyncConnectionPool[AsyncConnection[dict[str, Any]]]
    runner: TurnRunner
    metrics: Metrics
    oauth: OAuth


def runtime_for(request: Request) -> Runtime:
    return cast(Runtime, request.app.state.runtime)
