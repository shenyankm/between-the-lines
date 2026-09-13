"""Own model executions independently of HTTP response subscriptions."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from langgraph.types import Checkpointer

from .agents import MODEL
from .config import Settings
from .context import AgentTurn
from .error_catalog import FailureCode, failure_message
from .errors import ApiError
from .failures import classify_failure
from .logging_setup import request_id
from .schemas import TurnInput
from .services import GameService, owned_save

logger = logging.getLogger("btl.turns")
Reply = Callable[[AgentTurn, Checkpointer, dict[str, Any]], AsyncIterator[str]]
Epilogue = Callable[[dict[str, Any], dict[str, Any]], Awaitable[str]]
Observer = Callable[[str, float, int, float], None]


class TurnRunner:
    def __init__(
        self,
        settings: Settings,
        service: GameService,
        checkpointer: Checkpointer,
        reply: Reply,
        epilogue: Epilogue,
        observe: Observer,
    ):
        self.settings, self.service, self.checkpointer = settings, service, checkpointer
        self.reply, self.epilogue, self.observe = reply, epilogue, observe
        self.active: set[object] = set()
        self.tasks: set[asyncio.Task[dict[str, Any] | None]] = set()
        self.accepting = True

    async def submit(
        self, save_id: str, user_id: str, body: TurnInput
    ) -> tuple[str, asyncio.Future[dict[str, Any] | None]]:
        reservation = object()

        def reserve() -> None:
            if (
                body.action == "speak"
                and self.settings.agent_mode == "deepseek"
                and not self.settings.deepseek_api_key
            ):
                raise ApiError(503, "model_unconfigured")
            if not self.accepting or len(self.active) >= self.settings.max_concurrent_turns:
                raise ApiError(
                    429,
                    "concurrency_budget_exhausted",
                    None,
                    {"Retry-After": "5"},
                )
            self.active.add(reservation)

        try:
            turn = await self.service.begin_turn(save_id, user_id, body, reserve)
        except BaseException:
            self.active.discard(reservation)
            raise
        if turn.status != "running":
            result: asyncio.Future[dict[str, Any] | None] = (
                asyncio.get_running_loop().create_future()
            )
            result.set_result(turn.result)
            self.observe("replayed", 0, 0, 0)
            return turn.id, result
        context = AgentTurn(turn.id, turn.user_id, turn.save_id, body)
        # No await between committed acceptance and registration. A disconnect can
        # cancel the subscriber, never this strongly-held task.
        task = asyncio.create_task(self.execute(context, reservation), name=f"turn:{turn.id}")
        self.tasks.add(task)
        task.add_done_callback(self._finished)
        return turn.id, task

    def _finished(self, task: asyncio.Task[dict[str, Any] | None]) -> None:
        self.tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error(
                "turn_persistence_failed",
                extra={
                    "fields": {
                        "kind": type(task.exception()).__name__,
                        "turn_id": task.get_name().removeprefix("turn:"),
                        "code": "turn_persistence_failed",
                    }
                },
            )

    async def execute(self, turn: AgentTurn, reservation: object) -> dict[str, Any] | None:
        usage: dict[str, Any] = {
            "model": MODEL,
            "mode": self.settings.agent_mode,
            "model_calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }
        started = time.monotonic()
        outcome = "failed"
        reply = ""
        failure: FailureCode | None = None
        try:
            try:
                async with asyncio.timeout(self.settings.turn_timeout_seconds):
                    if turn.input.action == "speak":
                        async for chunk in self.reply(turn, self.checkpointer, usage):
                            reply += chunk
                    elif turn.input.action == "epilogue":
                        async with self.service.sessions() as db:
                            save = await owned_save(db, turn.save_id, turn.user_id)
                        if save.state["ending"]:
                            reply = await self.epilogue(save.state, usage)
            except asyncio.CancelledError:
                failure = FailureCode.INTERRUPTED
                reply = failure_message(failure)
            except Exception as exc:
                failure = classify_failure(exc)
                reply = failure_message(failure)
                logger.warning(
                    "turn_failed",
                    extra={
                        "fields": {
                            "turn_id": turn.id,
                            "kind": type(exc).__name__,
                            "code": failure.value,
                        }
                    },
                )
            usage["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            result = await self.service.finish_turn(
                turn.id, reply, usage, failure is not None, failure, request_id.get()
            )
            if result:
                outcome = result["status"]
            return result
        finally:
            self.active.discard(reservation)
            self.observe(
                outcome,
                time.monotonic() - started,
                usage["model_calls"],
                usage.get("cost_estimate_usd", 0.0),
            )
            logger.info(
                "turn_finished",
                extra={
                    "fields": {
                        "turn_id": turn.id,
                        "npc": turn.input.npc,
                        "action": turn.input.action,
                        "outcome": outcome,
                        **usage,
                    }
                },
            )

    async def close(self) -> None:
        self.accepting = False
        if self.tasks:
            await asyncio.gather(*tuple(self.tasks), return_exceptions=True)
