"""Own model executions independently of HTTP response subscriptions."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from langgraph.types import Checkpointer

from .config import Settings
from .context import AgentTurn
from .domain import ACTION_TARGETS
from .errors import ApiError
from .game_types import GameState
from .reactions import action_reply
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
        self.live_replies: dict[str, str] = {}

    async def submit(
        self, save_id: str, user_id: str, body: TurnInput
    ) -> tuple[str, asyncio.Future[dict[str, Any] | None]]:
        reservation = object()

        def reserve() -> None:
            if body.action == "speak" and not self.settings.model_ready:
                raise ApiError(503, "model_unconfigured", "对话服务尚未配置，请联系管理员。")
            if not self.accepting or len(self.active) >= self.settings.max_concurrent_turns:
                raise ApiError(
                    429,
                    "concurrency_budget_exhausted",
                    "当前较忙，请稍后重试。",
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
                extra={"fields": {"kind": type(task.exception()).__name__}},
            )

    async def execute(self, turn: AgentTurn, reservation: object) -> dict[str, Any] | None:
        usage: dict[str, Any] = {
            "model": self.settings.model_name,
            "mode": self.settings.agent_mode,
            "model_calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }
        started = time.monotonic()
        outcome = "failed"
        reply = ""
        failed = False
        try:
            try:
                async with asyncio.timeout(self.settings.turn_timeout_seconds):
                    if turn.input.action == "speak":
                        async for chunk in self.reply(turn, self.checkpointer, usage):
                            if chunk and not reply:
                                usage["first_response_ms"] = round(
                                    (time.monotonic() - started) * 1000
                                )
                            reply += chunk
                            self.live_replies[turn.id] = reply
                    elif turn.input.action in ACTION_TARGETS:
                        async with self.service.sessions() as db:
                            save = await owned_save(db, turn.save_id, turn.user_id)
                        reply = action_reply(
                            turn.input.action, GameState.model_validate(save.state)
                        )
                        usage["first_response_ms"] = round((time.monotonic() - started) * 1000)
                    elif turn.input.action == "contact_wang":
                        reply = "王会计回复：‘谢谢菱菱，心意收到了。忙完项目，有空再聊。’这条私信只保存在你的手机里。"
                    elif turn.input.action in {"next", "leave", "epilogue"}:
                        async with self.service.sessions() as db:
                            save = await owned_save(db, turn.save_id, turn.user_id)
                        if save.state["ending"]:
                            reply = await self.epilogue(save.state, usage)
            except asyncio.CancelledError:
                failed = True
                reply = "回合已中断，已保存的行动仍然有效。"
            except Exception as exc:
                failed = True
                reply = "本次回复未完成，已保存的行动仍然有效。请刷新后继续。"
                logger.warning(
                    "turn_failed",
                    extra={"fields": {"turn_id": turn.id, "kind": type(exc).__name__}},
                )
            usage["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            result = await self.service.finish_turn(turn.id, reply, usage, failed)
            if result:
                outcome = result["status"]
            return result
        finally:
            self.live_replies.pop(turn.id, None)
            self.active.discard(reservation)
            self.observe(
                outcome,
                time.monotonic() - started,
                usage["model_calls"],
                usage.get("cost_estimate_usd") or 0.0,
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
