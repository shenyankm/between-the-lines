import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import Numeric, func, select
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import investigation
from .config import Settings
from .context import AgentContext, AgentTurn
from .db import Event, Save, Turn, User, utcnow
from .domain import (
    ACTION_LABELS,
    ACTION_TARGETS,
    NPCS,
    RuleError,
    apply_npc,
    apply_player,
    available_actions,
    visible_state,
)
from .errors import ApiError
from .game_types import Decision, GameState
from .schemas import PlayStateOut, TurnInput
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
        raise ApiError(409, "unsupported_save_version", "该存档需要更新版本的程序。")
    return {
        "id": save.id,
        "version": save.version,
        "state": GameState.model_validate(save.state).model_dump(mode="json"),
    }


async def owned_save(db: AsyncSession, save_id: str, user_id: str, lock: bool = False) -> Save:
    query = select(Save).where(Save.id == save_id, Save.user_id == user_id)
    save = await db.scalar(query.with_for_update() if lock else query)
    if not save:
        # One code for "not yours" and "not there" on purpose: distinguishing them
        # would let a caller enumerate save ids belonging to other players.
        raise ApiError(404, "save_not_found", "存档不存在。")
    if save.state_schema_version != 1:
        raise ApiError(409, "unsupported_save_version", "该存档需要更新版本的程序。")
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
                    raise ApiError(409, "request_id_reused", "请求编号已用于不同的操作。")
                if existing.status == "completed":
                    return existing
                if existing.status == "running":
                    raise ApiError(409, "turn_still_running", "该回合仍在处理，请稍后查询结果。")
                # A failed turn is retrieved with the old ID; explicit retries use a NEW ID
                # and refreshed version, preventing old checkpoint tools from being replayed.
                return existing
            reserve()
            active = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.status == "running")
            )
            if active:
                raise ApiError(409, "save_busy", "当前存档已有回合正在处理。")
            if save.version != body.version:
                raise ApiError(409, "version_conflict", "进度已变化，请刷新后重试。")
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
                    "今日回合额度已用完。",
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
                        "本月服务额度已用尽，请联系管理员。",
                        {"Retry-After": str(_seconds_until_next_utc_month(now))},
                    )
            if body.action == "speak" and not body.text.strip():
                raise ApiError(422, "empty_message", "请输入要说的话。")
            try:
                state, text = apply_player(GameState.model_validate(save.state), body.action)
            except RuleError as exc:
                raise ApiError(422, "rule_violation", str(exc)) from exc
            if body.action in investigation.DECISIONS:
                reason = body.text.strip()
                if not 2 <= len(reason) <= 500:
                    raise ApiError(422, "decision_reason_required", "请用2到500字写下选择理由。")
                state.decisions.append(
                    Decision(
                        act=state.act,
                        action=body.action,
                        reason=reason,
                        evidence=list(state.evidence),
                    )
                )
                text += " 我的理由：" + reason
            if body.action == "next":
                text = self.story.acts[state.act].intro
            turn = Turn(
                save_id=save_id, user_id=user_id, request_id=str(body.request_id), payload=payload
            )
            db.add(turn)
            await db.flush()
            save.state = state.model_dump(mode="json")
            save.version += 1
            target = ACTION_TARGETS.get(body.action, body.npc)
            audience = (
                [body.npc]
                if body.action == "speak"
                else [target]
                if body.action in {"report", "boundary", "repair", "document_rumor"}
                or (
                    body.action in investigation.RULES
                    and body.action not in investigation.PUBLIC_ACTIONS
                )
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
                        "npc": target,
                        "action": body.action,
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
            # Event journal is persistent and already role scoped. Important quotes
            # survive ordinary chat scrolling without a second summarization model.
            memories = (
                await db.scalars(
                    select(Event)
                    .where(
                        Event.save_id == turn.save_id,
                        Event.audience.contains([npc]),
                        Event.operation == "memory",
                    )
                    .order_by(Event.created_at.desc(), Event.id.desc())
                    .limit(24)
                )
            ).all()
            milestones = (
                await db.scalars(
                    select(Event)
                    .where(
                        Event.save_id == turn.save_id,
                        Event.audience.contains([npc]),
                        Event.operation == "player",
                        Event.data["action"].astext != "speak",
                    )
                    .order_by(Event.created_at.desc(), Event.id.desc())
                    .limit(16)
                )
            ).all()
        state = GameState.model_validate(save.state)
        return AgentContext.model_validate(
            {
                "facts": visible_state(state, npc),
                "relationship": f"{getattr(state.trust, npc)}/100；孙淼为熟悉度和戒心，不表示诚实；李姐、张工为工作信任，不改变职业底线。",
                "evidence": investigation.npc_evidence(state, npc),
                "history": [
                    e.data
                    for e in reversed(events)
                    if e.data["kind"] not in {"memory", "suggestion"}
                ],
                "memories": [
                    "玩家曾亲口说（不等于已执行）：" + e.data["text"] for e in reversed(memories)
                ]
                + ["已确认的行动：" + e.data["text"] for e in reversed(milestones)],
                "available_actions": {
                    a: label
                    for a, label in available_actions(state).items()
                    if a not in investigation.RULES
                },
                "consequences": [
                    c
                    for c in state.consequences
                    if ("私下" not in c and "表面应下" not in c and "时限转交" not in c)
                    or (npc == "zhang" and ("私下核实传言" in c or "张工私下更正" in c))
                ],
            }
        )

    async def _agent_note(
        self, turn: AgentTurn, kind: str, text: str, action: str | None = None
    ) -> str:
        async with self.sessions.begin() as db:
            save = await owned_save(db, turn.save_id, turn.user_id, True)
            record = await db.get(Turn, turn.id)
            if (
                not record
                or record.save_id != save.id
                or record.status != "running"
                or record.payload["npc"] != turn.input.npc
            ):
                raise RuleError("回合已结束或角色无权操作。")
            if record.payload["action"] != "speak":
                raise RuleError("行动回应时不能生成新的建议或记忆。")
            if kind == "suggestion":
                if action not in available_actions(GameState.model_validate(save.state)):
                    raise RuleError("当前无法提出这项行动。")
            elif not text.strip() or len(text) > 240 or text not in record.payload["text"]:
                raise RuleError("只能记住玩家本轮亲口说过的原话，最多240字。")
            previous = await db.scalar(
                select(Event).where(Event.turn_id == turn.id, Event.operation == kind)
            )
            if previous:
                return "本轮已经记录，请直接回复玩家。"
            db.add(
                Event(
                    save_id=save.id,
                    turn_id=turn.id,
                    operation=kind,
                    audience=[turn.input.npc],
                    data={
                        "kind": kind,
                        "text": text,
                        "npc": turn.input.npc,
                        "act": save.state["act"],
                        "action": action,
                    },
                )
            )
            return (
                "建议已展示，尚未执行，等待玩家确认。"
                if kind == "suggestion"
                else "已记住玩家原话；这不是已经完成的行动。"
            )

    async def propose_action(self, turn: AgentTurn, action: str) -> str:
        if action not in ACTION_LABELS:
            raise RuleError("没有这项可建议的行动。")
        return await self._agent_note(turn, "suggestion", ACTION_LABELS[action], action)

    async def remember_player(self, turn: AgentTurn, quote: str) -> str:
        return await self._agent_note(turn, "memory", quote)

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
            if turn.payload["action"] != "speak":
                raise RuleError("这是对已确认行动的回应，不能追加工作操作。")
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
        self, turn_id: str, text: str | None, usage: dict[str, Any], error: bool = False
    ) -> dict[str, Any] | None:
        input_price: float | None = self.settings.deepseek_input_usd_per_million
        output_price: float | None = self.settings.deepseek_output_usd_per_million
        if self.settings.agent_mode == "openai":
            input_price = self.settings.openai_input_usd_per_million
            output_price = self.settings.openai_output_usd_per_million
        priced = input_price is not None and output_price is not None
        usage["billing_complete"] = not error and (priced or self.settings.agent_mode == "mock")
        usage["cost_estimate_usd"] = (
            0.0
            if self.settings.agent_mode == "mock"
            else round(
                (
                    usage.get("input_tokens", 0) * (input_price or 0)
                    + usage.get("output_tokens", 0) * (output_price or 0)
                )
                / 1_000_000,
                8,
            )
        )
        if self.settings.agent_mode != "mock" and not priced:
            usage["cost_estimate_usd"] = None
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
                        audience=[]
                        if epilogue or turn.payload["action"] == "contact_wang"
                        else [ACTION_TARGETS.get(turn.payload["action"], turn.payload["npc"])],
                        data={
                            "kind": "epilogue"
                            if epilogue
                            else "work"
                            if turn.payload["action"] == "contact_wang"
                            else "npc",
                            "text": text,
                            "npc": ACTION_TARGETS.get(turn.payload["action"], turn.payload["npc"]),
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
                turn_id, "回合已中断。已保存的行动仍然有效，请刷新进度后继续。", usage, True
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
                    "investigation": investigation.read_model(GameState.model_validate(save.state)),
                    "events": [{"id": event.id, **event.data} for event in events],
                    "active_turn": {"id": active.id, "request_id": active.request_id}
                    if active
                    else None,
                }
            )
