import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import Numeric, func, select
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .config import Settings
from .context import AgentContext, AgentTurn
from .db import Event, Save, Turn, User, utcnow
from .domain import NPCS, RuleError, apply_npc, apply_player, visible_state
from .error_catalog import FailureCode, failure_message
from .errors import ApiError
from .game_types import GameState
from .schemas import PlayStateOut, SaveOut, TurnFailure, TurnInput
from .story import load_story

logger = logging.getLogger("btl.services")


def _start_of_utc_month(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _seconds_until_next_utc_month(now: datetime) -> int:
    """Whole seconds until the cap's window rolls over; never less than one."""
    year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return max(
        1, int((_start_of_utc_month(now).replace(year=year, month=month) - now).total_seconds())
    )


async def month_to_date_cost(db: AsyncSession) -> float:
    """Estimated spend recorded since the start of the current UTC month.

    Summed from `turns.usage` rather than held in a counter: that column is already
    the billing record of truth, it survives restarts, and a process-local counter
    would under-report after every deploy -- exactly when an overrun matters most.
    """
    # usage->>'x' is text, so it needs a cast before SUM will take it. Turns written
    # before the field existed yield NULL, which SUM ignores rather than poisoning.
    total = await db.scalar(
        select(
            func.coalesce(func.sum(Turn.usage["cost_estimate_usd"].astext.cast(Numeric)), 0)
        ).where(Turn.created_at >= _start_of_utc_month(utcnow()))
    )
    return float(total or 0)


def snapshot(save: Save) -> dict[str, Any]:
    if save.state_schema_version != 1:
        raise ApiError(409, "unsupported_save_version")
    return SaveOut(
        id=save.id, version=save.version, state=GameState.model_validate(save.state)
    ).model_dump(mode="json")


async def owned_save(db: AsyncSession, save_id: str, user_id: str, lock: bool = False) -> Save:
    query = select(Save).where(Save.id == save_id, Save.user_id == user_id)
    save = await db.scalar(query.with_for_update() if lock else query)
    if not save:
        # One code for "not yours" and "not there" on purpose: distinguishing them
        # would let a caller enumerate save ids belonging to other players.
        raise ApiError(404, "save_not_found")
    if save.state_schema_version != 1:
        raise ApiError(409, "unsupported_save_version")
    return save


class GameService:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], settings: Settings):
        self.sessions = sessions
        self.settings = settings
        self.story = load_story()

    async def begin_turn(
        self,
        save_id: str,
        user_id: str,
        body: TurnInput,
        reserve: Callable[[], None] = lambda: None,
    ) -> Turn:
        async with self.sessions.begin() as db:
            # Lock user before save: serializes quota checks across the user's saves.
            await db.scalar(select(User).where(User.id == user_id).with_for_update())
            save = await owned_save(db, save_id, user_id, True)
            existing = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.request_id == str(body.request_id))
            )
            payload = body.model_dump(mode="json")
            if existing:
                if existing.payload != payload:
                    raise ApiError(409, "request_id_reused")
                if existing.status == "completed":
                    return existing
                if existing.status == "running":
                    raise ApiError(409, "turn_still_running")
                # A failed turn is retrieved with the old ID; explicit retries use a NEW ID
                # and refreshed version, preventing old checkpoint tools from being replayed.
                return existing
            reserve()
            active = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.status == "running")
            )
            if active:
                raise ApiError(409, "save_busy")
            if save.version != body.version:
                raise ApiError(409, "version_conflict")
            now = utcnow()
            since = now.replace(hour=0, minute=0, second=0, microsecond=0)
            used = (
                await db.scalar(
                    select(func.count())
                    .select_from(Turn)
                    .where(Turn.user_id == user_id, Turn.created_at >= since)
                )
                or 0
            )
            if used >= self.settings.daily_turn_limit:
                raise ApiError(
                    429,
                    "daily_limit_reached",
                    None,
                    # The window is a UTC day, so the wait is exactly knowable. Leaving
                    # a client to guess is what turns a quota into a retry loop.
                    {
                        "Retry-After": str(
                            int((since + timedelta(days=1) - now).total_seconds()) + 1
                        )
                    },
                )
            # The billing kill switch. Exempt in mock mode, where every turn costs
            # nothing and a cap would only block CI; config.production_guards is what
            # forbids booting a real deployment without one.
            if self.settings.monthly_cost_cap_usd > 0 and self.settings.agent_mode != "mock":
                spent = await month_to_date_cost(db)
                if spent >= self.settings.monthly_cost_cap_usd:
                    # Aggregate spend, never a credential and never a player's message.
                    logger.warning(
                        "cost_cap_reached",
                        extra={
                            "fields": {
                                "spent_usd": spent,
                                "cap_usd": self.settings.monthly_cost_cap_usd,
                            }
                        },
                    )
                    raise ApiError(
                        503,
                        "monthly_cost_cap_reached",
                        None,
                        {"Retry-After": str(_seconds_until_next_utc_month(now))},
                    )
            if body.action == "speak" and not body.text.strip():
                raise ApiError(422, "empty_message")
            try:
                state, text = apply_player(GameState.model_validate(save.state), body.action)
            except RuleError as exc:
                raise ApiError(422, "rule_violation", str(exc)) from exc
            if body.action == "next":
                text = self.story.acts[state.act].intro
            turn = Turn(
                save_id=save_id, user_id=user_id, request_id=str(body.request_id), payload=payload
            )
            db.add(turn)
            await db.flush()
            save.state = state.model_dump(mode="json")
            save.version += 1
            audience = (
                [body.npc]
                if body.action == "speak"
                else ["sun"]
                if body.action in {"boundary", "cut_ties", "keep_distance"}
                else ["zhang"]
                if body.action == "report"
                else []
                if body.action == "contact_wang"
                else sorted(NPCS)
            )
            db.add(
                Event(
                    save_id=save_id,
                    turn_id=turn.id,
                    operation="player",
                    audience=audience,
                    data={
                        "kind": "player",
                        "text": text or body.text,
                        "npc": body.npc,
                        "action": body.action,
                        "act": state.act,
                    },
                )
            )
            if body.action == "contact_wang":
                db.add(
                    Event(
                        save_id=save_id,
                        turn_id=turn.id,
                        operation="wang_reply",
                        audience=[],
                        data={
                            "kind": "personal",
                            "text": self.story.wang_reply,
                            "npc": body.npc,
                            "act": state.act,
                        },
                    )
                )
            return turn

    async def context_for(self, turn: AgentTurn) -> AgentContext:
        npc = turn.input.npc
        async with self.sessions() as db:
            save = await owned_save(db, turn.save_id, turn.user_id)
            events = (
                await db.scalars(
                    select(Event)
                    .where(Event.save_id == turn.save_id, Event.audience.contains([npc]))
                    .order_by(Event.created_at.desc(), Event.id.desc())
                    .limit(30)
                )
            ).all()
        return AgentContext.model_validate(
            {
                "facts": visible_state(GameState.model_validate(save.state), npc),
                "history": [e.data for e in reversed(events)],
            }
        )

    async def npc_operation(self, turn_id: str, npc: str, operation: str) -> str:
        async with self.sessions.begin() as db:
            # Unreachable None: called only from the agent tool closure with the id of a
            # turn committed earlier in this request, and no route cascades a turn away.
            turn = cast(Turn, await db.get(Turn, turn_id))
            save = await owned_save(db, turn.save_id, turn.user_id, True)
            # Stale or timed-out executions must never mutate the world.
            await db.refresh(turn)
            if turn.status != "running" or turn.payload["npc"] != npc:
                raise RuleError("回合已结束或角色无权操作。")
            previous = await db.scalar(
                select(Event).where(Event.turn_id == turn_id, Event.operation == operation)
            )
            if previous:
                return cast(str, previous.data["text"])
            state, text = apply_npc(GameState.model_validate(save.state), npc, operation)
            save.state = state.model_dump(mode="json")
            save.version += 1
            audience = ["zhang"] if operation == "support_project" else sorted(NPCS)
            db.add(
                Event(
                    save_id=save.id,
                    turn_id=turn_id,
                    operation=operation,
                    audience=audience,
                    data={"kind": "work", "text": text, "npc": npc, "act": state.act},
                )
            )
            return text

    async def finish_turn(
        self,
        turn_id: str,
        text: str | None,
        usage: dict[str, Any],
        error: bool = False,
        failure: FailureCode | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any] | None:
        usage["billing_complete"] = not error
        usage["cost_estimate_usd"] = (
            0.0
            if self.settings.agent_mode == "mock"
            else round(
                (
                    usage.get("input_tokens", 0) * self.settings.deepseek_input_usd_per_million
                    + usage.get("output_tokens", 0) * self.settings.deepseek_output_usd_per_million
                )
                / 1_000_000,
                8,
            )
        )
        async with self.sessions.begin() as db:
            turn = cast(Turn, await db.get(Turn, turn_id))
            save = await owned_save(db, turn.save_id, turn.user_id, True)
            await db.refresh(turn)
            if turn.status != "running":
                return turn.result
            turn.status = "failed" if error else "completed"
            turn.updated_at = utcnow()
            turn.usage = usage
            if not error and text:
                epilogue = bool(save.state["ending"])
                db.add(
                    Event(
                        save_id=save.id,
                        turn_id=turn.id,
                        operation="reply",
                        audience=[] if epilogue else [turn.payload["npc"]],
                        data={
                            "kind": "epilogue" if epilogue else "npc",
                            "text": text,
                            "npc": turn.payload["npc"],
                            "act": save.state["act"],
                        },
                    )
                )
            turn.result = {
                "turn_id": turn.id,
                "status": turn.status,
                "text": text,
                "save": snapshot(save),
                "retryable": error,
                "failure": TurnFailure(
                    code=failure or FailureCode.UNKNOWN,
                    message=failure_message(failure or FailureCode.UNKNOWN),
                    request_id=correlation_id,
                ).model_dump(mode="json")
                if error
                else None,
            }
            return turn.result

    async def recover_stale_turns(self, all_running: bool = False) -> None:
        async with self.sessions() as db:
            query = select(Turn).where(Turn.status == "running")
            if not all_running:
                query = query.where(
                    Turn.created_at
                    < utcnow() - timedelta(seconds=self.settings.turn_timeout_seconds + 15)
                )
            stale = [(turn.id, dict(turn.usage)) for turn in (await db.scalars(query)).all()]
        for turn_id, usage in stale:
            await self.finish_turn(
                turn_id,
                failure_message(FailureCode.INTERRUPTED),
                usage,
                True,
                FailureCode.INTERRUPTED,
            )

    async def play_state(self, save_id: str, user_id: str) -> PlayStateOut:
        async with self.sessions.begin() as db:
            await db.execute(sql_text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            save = await owned_save(db, save_id, user_id)
            events = (
                await db.scalars(
                    select(Event)
                    .where(Event.save_id == save_id)
                    .order_by(Event.created_at, Event.id)
                )
            ).all()
            active = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.status == "running")
            )
            return PlayStateOut.model_validate(
                {
                    "save": snapshot(save),
                    "events": [{"id": event.id, **event.data} for event in events],
                    "active_turn": {"id": active.id, "request_id": active.request_id}
                    if active
                    else None,
                }
            )
