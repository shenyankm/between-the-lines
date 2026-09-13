import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import Numeric, case, func, select
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .actions import CATALOG, MAJOR, PRIVATE, available_actions, effects, role_actions, transition
from .budget import monthly_commitment, reservation, reserve_job, settle
from .config import Settings
from .context import AgentContext, AgentTurn
from .db import (
    AIJob,
    AISpend,
    Event,
    ProductEvent,
    Proposal,
    Save,
    SaveSnapshot,
    Turn,
    User,
    new_id,
    utcnow,
)
from .domain import NPCS, RuleError, apply_npc, visible_state
from .error_catalog import FailureCode, failure_message
from .errors import ApiError
from .game_types import GameStateV2, GameStateV3, parse_state
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
    if (
        save.state_schema_version not in {1, 2, 3}
        or save.state_schema_version != save.story_version
        or save.state.get("story_version", 1) != save.story_version
    ):
        raise ApiError(409, "unsupported_save_version")
    return SaveOut(
        id=save.id,
        version=save.version,
        state=parse_state(save.state),
        story_id=save.story_id,
        story_version=save.story_version,
        last_played_at=save.last_played_at,
        parent_save_id=save.parent_save_id,
        archived_at=save.archived_at,
        deleted_at=save.deleted_at,
    ).model_dump(mode="json")


async def owned_save(db: AsyncSession, save_id: str, user_id: str, lock: bool = False) -> Save:
    query = select(Save).where(
        Save.id == save_id, Save.user_id == user_id, Save.deleted_at.is_(None)
    )
    save = await db.scalar(query.with_for_update() if lock else query)
    if not save:
        # One code for "not yours" and "not there" on purpose: distinguishing them
        # would let a caller enumerate save ids belonging to other players.
        raise ApiError(404, "save_not_found")
    if (
        save.state_schema_version not in {1, 2, 3}
        or save.state_schema_version != save.story_version
        or save.state.get("story_version", 1) != save.story_version
    ):
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
            user = cast(
                User, await db.scalar(select(User).where(User.id == user_id).with_for_update())
            )
            save = await owned_save(db, save_id, user_id, True)
            existing = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.request_id == str(body.request_id))
            )
            payload = body.canonical_payload()
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
            if save.story_version < 3 or save.state.get("content_revision", 1) < 2:
                raise ApiError(422, "rule_violation", "旧版存档只读，请新建 v3 故事。")
            if body.target and body.target != ("group" if body.channel == "group" else body.npc):
                raise ApiError(422, "rule_violation", "会话目标与渠道不一致。")
            reserve()
            active = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.status == "running")
            )
            if active:
                raise ApiError(409, "save_busy")
            if save.version != body.version:
                raise ApiError(409, "version_conflict")
            if save.archived_at:
                raise ApiError(422, "rule_violation", "请先恢复归档。")
            if user.identity_type == "guest" and body.action == "next" and save.state["act"] == 1:
                raise ApiError(
                    422, "rule_violation", "第一幕已完成，绑定知乎后继续；试玩进度会保留。"
                )
            from .product import rate_limit

            await rate_limit(db, "turn:" + user_id, self.settings.mutation_limit_per_minute, 60)
            if body.action == "speak" and not body.text.strip():
                raise ApiError(422, "empty_message")
            try:
                before = parse_state(save.state)
                event_id = new_id()
                from .story_rules import MAJOR as V3_MAJOR

                major = V3_MAJOR if isinstance(before, GameStateV3) else MAJOR
                pending = await db.scalar(
                    select(Proposal).where(
                        Proposal.save_id == save_id, Proposal.status == "pending"
                    )
                )
                if (
                    isinstance(before, (GameStateV2, GameStateV3))
                    and body.action in major
                    and (
                        not pending
                        or pending.id != str(body.proposal_id)
                        or pending.version != save.version
                        or pending.action != body.action
                    )
                ):
                    raise ApiError(409, "version_conflict", "这项重要决定需要有效的确认卡。")
                if body.action == "propose":
                    if (
                        not isinstance(before, (GameStateV2, GameStateV3))
                        or body.proposed_action not in major
                    ):
                        raise RuleError("无效的确认行动。")
                    transition(
                        before,
                        str(body.proposed_action),
                        body.npc,
                        body.params.model_dump(exclude_none=True) if body.params else None,
                    )
                elif body.proposed_action is not None:
                    raise RuleError("行动提议只能使用 propose 提交。")
                state, text = transition(
                    before,
                    body.action,
                    body.npc,
                    body.params.model_dump(exclude_none=True) if body.params else None,
                    event_id,
                )
            except RuleError as exc:
                raise ApiError(422, "rule_violation", str(exc)) from exc
            if save.story_version == 2 and body.action == "next":
                interlude = load_story(2).acts[before.act].interlude
                if interlude:
                    db.add(
                        Event(
                            save_id=save_id,
                            turn_id=None,
                            operation="interlude",
                            audience=[],
                            data={
                                "kind": "narrative",
                                "text": interlude.text,
                                "npc": body.npc,
                                "act": before.act,
                            },
                        )
                    )
            if body.action == "begin" or (body.action == "next" and save.story_version == 1):
                db.add(
                    ProductEvent(
                        user_id=user_id,
                        name="first_action" if body.action == "begin" else "chapter_completed",
                        data={"act": before.act},
                    )
                )
            if body.action == "next":
                text = load_story(save.story_version).acts[state.act].intro
            turn = Turn(
                save_id=save_id, user_id=user_id, request_id=str(body.request_id), payload=payload
            )
            db.add(turn)
            await db.flush()
            if body.action in {"speak", "epilogue"} and body.channel != "group":
                await reserve_job(
                    db,
                    self.settings,
                    user,
                    save_id,
                    str(body.request_id),
                    "turn",
                    payload,
                    job_id=turn.id,
                )
            if body.discussion_id or body.perspective_id:
                from .product import validate_reference

                await validate_reference(db, save, body)
            if pending:
                pending.status = "confirmed" if str(body.proposal_id) == pending.id else "expired"
                await db.flush()
            save.last_played_at = utcnow()
            save.state = state.model_dump(mode="json")
            save.version += 1
            if body.action == "propose":
                db.add(
                    Proposal(
                        save_id=save_id,
                        turn_id=turn.id,
                        action=body.proposed_action,
                        version=save.version,
                    )
                )
            audience = (
                ["sun", "li", "zhang"]
                if body.channel == "group"
                else [body.npc]
                if body.action == "speak"
                else ["sun"]
                if body.action in {"boundary", "cut_ties", "keep_distance"}
                else ["zhang"]
                if body.action == "report"
                else []
                if body.action in PRIVATE or body.action in {"propose", "cancel_proposal"}
                else []
                if body.action.startswith("partner_")
                or body.action
                in {"draft_exit", "submit_exit", "leave", "rest", "draft_support", "submit_support"}
                else [body.npc]
                if body.channel == "dm"
                else ["sun", "li", "zhang"]
            )
            db.add(
                Event(
                    id=event_id,
                    save_id=save_id,
                    turn_id=turn.id,
                    operation="player",
                    audience=audience,
                    data={
                        "speaker": "player" if body.action == "speak" else "system",
                        "channel": body.channel
                        or (
                            "work"
                            if body.action
                            in {"submit_purchase", "supplement", "approve_purchase", "deliver"}
                            else "scene"
                        ),
                        "audience": audience,
                        "scene": getattr(state, "node", None),
                        "kind": "player",
                        "text": text or body.text,
                        "npc": body.npc,
                        "action": body.action,
                        "act": state.act,
                        "effects": effects(before, state, text),
                    },
                )
            )
            if body.action == "contact_wang" and save.story_version < 3:
                db.add(
                    Event(
                        save_id=save_id,
                        turn_id=turn.id,
                        operation="wang_reply",
                        audience=[],
                        data={
                            "kind": "personal",
                            "text": load_story(save.story_version).wang_reply,
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
                    .where(
                        Event.save_id == turn.save_id,
                        Event.audience.contains([npc]),
                        Event.turn_id.is_distinct_from(turn.id),
                    )
                    .order_by(Event.created_at.desc(), Event.id.desc())
                    .limit(30)
                )
            ).all()
        return AgentContext.model_validate(
            {
                "facts": visible_state(parse_state(save.state), npc),
                "checkpoint_namespace": save.checkpoint_namespace,
                "story_version": save.story_version,
                "history": [e.data for e in reversed(events)],
                "available_actions": [
                    action.model_dump() for action in role_actions(parse_state(save.state), npc)
                ],
            }
        )

    async def npc_operation(self, turn_id: str, npc: str, operation: str) -> str:
        async with self.sessions.begin() as db:
            # Unreachable None: called only from the agent tool closure with the id of a
            # turn committed earlier in this request, and no route cascades a turn away.
            turn = cast(Turn, await db.get(Turn, turn_id))
            await db.scalar(select(User).where(User.id == turn.user_id).with_for_update())
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
            before = parse_state(save.state)
            if isinstance(before, (GameStateV2, GameStateV3)):
                from .intents import grounded, grounded_v3

                evidence_gate = grounded_v3 if isinstance(before, GameStateV3) else grounded
                if not self.settings.automatic_intents_enabled or not evidence_gate(
                    turn.payload["text"], operation, npc, before.act
                ):
                    raise RuleError("本轮未明确请求此操作，请使用行动按钮。")
                event_id = new_id()
                state, text = transition(before, operation, npc, event_id=event_id)
            else:
                state, text = apply_npc(before, npc, operation)
            save.state = state.model_dump(mode="json")
            save.version += 1
            audience = ["zhang"] if operation == "support_project" else sorted(NPCS)
            db.add(
                Event(
                    save_id=save.id,
                    turn_id=turn_id,
                    id=event_id if isinstance(before, (GameStateV2, GameStateV3)) else new_id(),
                    operation=operation,
                    audience=audience,
                    data={
                        "speaker": "system",
                        "channel": turn.payload.get("channel") or "scene",
                        "kind": "work",
                        "text": text,
                        "npc": npc,
                        "act": state.act,
                        "effects": effects(before, state, text),
                    },
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
            await db.scalar(select(User).where(User.id == turn.user_id).with_for_update())
            save = await owned_save(db, turn.save_id, turn.user_id, True)
            await db.refresh(turn)
            if turn.status != "running":
                return turn.result
            turn.status = "failed" if error else "completed"
            turn.updated_at = utcnow()
            turn.usage = usage
            job = await db.get(AIJob, turn.id)
            if job:
                await settle(db, job, self.settings, usage, error)
            if not error and text:
                epilogue = bool(save.state["ending"])
                db.add(
                    Event(
                        save_id=save.id,
                        turn_id=turn.id,
                        operation="reply",
                        audience=[] if epilogue else [turn.payload["npc"]],
                        data={
                            "speaker": turn.payload["npc"],
                            "channel": turn.payload.get("channel") or "scene",
                            "audience": [] if epilogue else [turn.payload["npc"]],
                            "kind": "epilogue" if epilogue else "npc",
                            "text": text,
                            "npc": turn.payload["npc"],
                            "act": save.state["act"],
                        },
                    )
                )
            await db.flush()
            state = parse_state(save.state)
            flags = set(state.flags)
            chapter_complete = save.story_version == 2 and (
                (state.act == 1 and bool(flags & {"boundary", "confronted", "wang_contacted"}))
                or (state.act == 2 and state.procurement == "approved")
                or (
                    state.act == 3
                    and {"clarified", "delivered"} <= flags
                    and bool(flags & {"sun_cut", "sun_observe"})
                )
            )
            if chapter_complete and not await db.scalar(
                select(ProductEvent.id)
                .where(
                    ProductEvent.name == "chapter_completed",
                    ProductEvent.data["save"].astext == save.id,
                    ProductEvent.data["act"].as_integer() == state.act,
                )
                .limit(1)
            ):
                db.add(
                    ProductEvent(
                        user_id=turn.user_id,
                        name="chapter_completed",
                        data={"save": save.id, "act": state.act},
                    )
                )
            if (
                turn.payload["action"] == "speak"
                and turn.payload["npc"] == "li"
                and state.act == 2
                and "materials" not in flags
            ):
                from .intents import grounded

                if grounded(turn.payload["text"], "approve_purchase", "li", 2):
                    db.add(
                        ProductEvent(
                            user_id=turn.user_id,
                            name="approval_stuck",
                            data={"key": turn.request_id},
                        )
                    )
            await self.capture_snapshot(db, save)
            action_events = (await db.scalars(select(Event).where(Event.turn_id == turn.id))).all()
            turn.result = {
                "turn_id": turn.id,
                "status": turn.status,
                "text": text,
                "save": snapshot(save),
                "retryable": error,
                "effects": [
                    effect for event in action_events for effect in event.data.get("effects", [])
                ],
                "proposal": await self.proposal_for(db, save),
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
                    .order_by(Event.created_at.desc(), Event.id.desc())
                    .limit(50)
                )
            ).all()
            events = list(reversed(events))
            active = await db.scalar(
                select(Turn).where(Turn.save_id == save_id, Turn.status == "running")
            )
            contact_key = case(
                (Event.data["channel"].astext == "group", "group"), else_=Event.data["npc"].astext
            )
            conversations = (
                await db.execute(
                    select(
                        contact_key,
                        Event.data["text"].astext,
                        func.count().over(partition_by=contact_key),
                    )
                    .where(
                        Event.save_id == save_id, Event.data["channel"].astext.in_(["dm", "group"])
                    )
                    .distinct(contact_key)
                    .order_by(contact_key, Event.created_at.desc(), Event.id.desc())
                )
            ).all()
            contacts = {
                key: {
                    "preview": preview,
                    "count": count,
                    "unread": count
                    > save.reading.get("group" if key == "group" else "dm_" + key, 0),
                }
                for key, preview, count in conversations
            }
            return PlayStateOut.model_validate(
                {
                    "save": snapshot(save),
                    "available_actions": available_actions(parse_state(save.state))
                    if save.story_version == 3 and save.state.get("content_revision", 1) == 2
                    else [],
                    "performance_version": save.version,
                    "performance": load_story(
                        save.story_version, save.state.get("content_revision", 1)
                    ).performance_for(parse_state(save.state)),
                    "reading": save.reading,
                    "contacts": contacts,
                    "proposal": await self.proposal_for(db, save),
                    "ai": await self.ai_status(db, user_id),
                    "events": [{"id": event.id, **event.data} for event in events],
                    "events_cursor": events[0].id if len(events) == 50 else None,
                    "active_turn": {"id": active.id, "request_id": active.request_id}
                    if active
                    else None,
                }
            )

    async def proposal_for(self, db: AsyncSession, save: Save) -> dict[str, Any] | None:
        proposal = await db.scalar(
            select(Proposal).where(
                Proposal.save_id == save.id,
                Proposal.status == "pending",
                Proposal.version == save.version,
            )
        )
        if not proposal:
            return None
        from .story_rules import CATALOG as V3_CATALOG

        definition = (V3_CATALOG if save.story_version == 3 else CATALOG)[proposal.action]
        return {
            "id": proposal.id,
            "action": proposal.action,
            "version": proposal.version,
            "label": definition[0],
            "effect": definition[4],
        }

    async def ai_status(self, db: AsyncSession, user_id: str) -> dict[str, Any]:
        user = cast(User, await db.get(User, user_id))
        since = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        count = (
            await db.scalar(
                select(func.count())
                .select_from(AISpend)
                .where(
                    AISpend.user_id == user_id,
                    *([] if user.identity_type == "guest" else [AISpend.created_at >= since]),
                )
            )
            or 0
        )
        remaining = max(
            0,
            (
                self.settings.guest_ai_limit
                if user.identity_type == "guest"
                else self.settings.daily_turn_limit
            )
            - count,
        )
        ready = self.settings.agent_mode == "mock" or bool(self.settings.deepseek_api_key)
        if ready and self.settings.agent_mode != "mock" and self.settings.monthly_cost_cap_usd > 0:
            ready = (await monthly_commitment(db)) + reservation(
                self.settings, self.settings.max_model_calls
            ) <= self.settings.monthly_cost_cap_usd
        return {
            "available": remaining > 0 and ready,
            "remaining": remaining,
            "reason": None if remaining > 0 and ready else "AI 暂不可用，行动按钮和存档继续可用。",
        }

    async def capture_snapshot(self, db: AsyncSession, save: Save) -> None:
        if save.story_version not in {2, 3}:
            return
        state = parse_state(save.state)
        node = None
        if state.act in {1, 2, 3}:
            node = f"act_{state.act}"
        if (
            isinstance(state, GameStateV2)
            and state.act == 2
            and state.procurement == "approved"
            and not state.partner_choice
        ):
            node = "before_partner"
        if (
            state.act == 3
            and {"clarified", "delivered"} <= set(state.flags)
            and not {"sun_cut", "sun_observe"} & set(state.flags)
        ):
            node = "before_sun"
        if not node or await db.scalar(
            select(SaveSnapshot.id).where(
                SaveSnapshot.save_id == save.id, SaveSnapshot.node == node
            )
        ):
            return
        history = (
            await db.scalars(
                select(Event).where(Event.save_id == save.id).order_by(Event.created_at, Event.id)
            )
        ).all()
        db.add(
            SaveSnapshot(
                save_id=save.id,
                node=node,
                state=save.state,
                history=[
                    {
                        "id": e.id,
                        "turn_key": e.turn_id or e.data.get("history_group"),
                        "operation": e.operation,
                        "audience": e.audience,
                        "data": e.data,
                    }
                    for e in history
                ],
            )
        )

    async def player_intent(self, turn_id: str, npc: str, action: str, evidence: str = "") -> str:
        from .intents import grounded, grounded_major, grounded_v3
        from .story_rules import MAJOR as V3_MAJOR

        async with self.sessions.begin() as db:
            turn = cast(Turn, await db.get(Turn, turn_id))
            await db.scalar(select(User).where(User.id == turn.user_id).with_for_update())
            save = await owned_save(db, turn.save_id, turn.user_id, True)
            await db.refresh(turn)
            if (
                turn.status != "running"
                or turn.payload["npc"] != npc
                or not self.settings.automatic_intents_enabled
            ):
                raise RuleError("当前回合不能提交意图。")
            previous = await db.scalar(
                select(Event).where(Event.turn_id == turn_id, Event.operation == "player_intent")
            )
            if previous:
                return str(previous.data["text"])
            before = parse_state(save.state)
            if isinstance(before, GameStateV3) and (
                not evidence.strip() or evidence not in turn.payload["text"]
            ):
                raise RuleError("请引用本轮原文作为依据；当前意图未执行。")
            major_actions = V3_MAJOR if isinstance(before, GameStateV3) else MAJOR
            if isinstance(before, (GameStateV2, GameStateV3)) and action in major_actions:
                if not (
                    grounded_v3(turn.payload["text"], action, npc, before.act)
                    if isinstance(before, GameStateV3)
                    else grounded_major(turn.payload["text"], action)
                ):
                    raise RuleError("这项重大选择需要你通过按钮确认。")
                transition(before, action, npc)
                old = await db.scalar(
                    select(Proposal).where(
                        Proposal.save_id == save.id, Proposal.status == "pending"
                    )
                )
                if old:
                    old.status = "expired"
                    await db.flush()
                db.add(
                    Proposal(save_id=save.id, turn_id=turn_id, action=action, version=save.version)
                )
                text = "已提出候选行动，等待玩家确认；尚未执行。"
                db.add(
                    Event(
                        save_id=save.id,
                        turn_id=turn_id,
                        operation="player_intent",
                        audience=[npc],
                        data={"kind": "work", "text": text, "npc": npc, "act": before.act},
                    )
                )
                return text
            if not isinstance(before, (GameStateV2, GameStateV3)) or not (
                grounded_v3(turn.payload["text"], action, npc, before.act)
                if isinstance(before, GameStateV3)
                else action in {"boundary", "report"}
                and grounded(turn.payload["text"], action, npc, before.act)
            ):
                raise RuleError("本轮表达不足以确认这一行动，请使用按钮。")
            event_id = new_id()
            state, text = transition(before, action, npc, event_id=event_id)
            save.state = state.model_dump(mode="json")
            save.version += 1
            db.add(
                Event(
                    save_id=save.id,
                    turn_id=turn_id,
                    id=event_id,
                    operation="player_intent",
                    audience=["sun", "li", "zhang"]
                    if action in {"clarify", "review_clarification"}
                    else [npc],
                    data={
                        "speaker": "system",
                        "channel": "group"
                        if action in {"clarify", "review_clarification"}
                        else turn.payload.get("channel") or "scene",
                        "kind": "work",
                        "text": text,
                        "npc": npc,
                        "act": state.act,
                        "action": action,
                        "effects": effects(before, state, text),
                    },
                )
            )
            return text
