from datetime import timedelta
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import Event, Save, Session, Turn, User, utcnow
from .domain import NPCS, RuleError, apply_npc, apply_player, visible_state
from .schemas import TurnInput

settings = get_settings()


def snapshot(save: Save) -> dict[str, Any]:
    return {"id": save.id, "version": save.version, "state": save.state}


async def owned_save(db: AsyncSession, save_id: str, user_id: str, lock: bool = False) -> Save:
    query = select(Save).where(Save.id == save_id, Save.user_id == user_id)
    save = await db.scalar(query.with_for_update() if lock else query)
    if not save:
        raise HTTPException(404, "存档不存在。")
    return save


async def begin_turn(save_id: str, user_id: str, body: TurnInput) -> Turn:
    async with Session.begin() as db:
        # Lock user before save: serializes quota checks across the user's saves.
        await db.scalar(select(User).where(User.id == user_id).with_for_update())
        save = await owned_save(db, save_id, user_id, True)
        existing = await db.scalar(
            select(Turn).where(Turn.save_id == save_id, Turn.request_id == str(body.request_id))
        )
        payload = body.model_dump(mode="json")
        if existing:
            if existing.payload != payload:
                raise HTTPException(409, "请求编号已用于不同的操作。")
            if existing.status == "completed":
                return existing
            if existing.status == "running":
                raise HTTPException(409, "该回合仍在处理，请稍后查询结果。")
            # A failed turn is retrieved with the old ID; explicit retries use a NEW ID
            # and refreshed version, preventing old checkpoint tools from being replayed.
            return existing
        active = await db.scalar(
            select(Turn).where(Turn.save_id == save_id, Turn.status == "running")
        )
        if active:
            raise HTTPException(409, "当前存档已有回合正在处理。")
        if save.version != body.version:
            raise HTTPException(409, "进度已变化，请刷新后重试。")
        since = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        used = (
            await db.scalar(
                select(func.count())
                .select_from(Turn)
                .where(Turn.user_id == user_id, Turn.created_at >= since)
            )
            or 0
        )
        if used >= settings.daily_turn_limit:
            raise HTTPException(429, "今日回合额度已用完。")
        if body.action == "speak" and not body.text.strip():
            raise HTTPException(422, "请输入要说的话。")
        try:
            state, text = apply_player(save.state, body.action)
        except RuleError as exc:
            raise HTTPException(422, str(exc)) from exc
        turn = Turn(
            save_id=save_id, user_id=user_id, request_id=str(body.request_id), payload=payload
        )
        db.add(turn)
        await db.flush()
        save.state = state
        save.version += 1
        audience = (
            [body.npc]
            if body.action == "speak"
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
                    "act": state["act"],
                },
            )
        )
        return turn


async def context_for(turn: Turn) -> dict[str, Any]:
    npc = turn.payload["npc"]
    async with Session() as db:
        save = await owned_save(db, turn.save_id, turn.user_id)
        events = (
            await db.scalars(
                select(Event)
                .where(Event.save_id == turn.save_id, Event.audience.contains([npc]))
                .order_by(Event.created_at.desc())
                .limit(30)
            )
        ).all()
    return {"facts": visible_state(save.state, npc), "history": [e.data for e in reversed(events)]}


async def npc_operation(turn_id: str, npc: str, operation: str) -> str:
    async with Session.begin() as db:
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
        state, text = apply_npc(save.state, npc, operation)
        save.state = state
        save.version += 1
        audience = ["zhang"] if operation == "support_project" else sorted(NPCS)
        db.add(
            Event(
                save_id=save.id,
                turn_id=turn_id,
                operation=operation,
                audience=audience,
                data={"kind": "work", "text": text, "npc": npc, "act": state["act"]},
            )
        )
        return text


async def finish_turn(
    turn_id: str, text: str | None, usage: dict[str, Any], error: bool = False
) -> dict[str, Any] | None:
    usage["billing_complete"] = not error
    usage["cost_estimate_usd"] = (
        0.0
        if settings.agent_mode == "mock"
        else round(
            (
                usage.get("input_tokens", 0) * settings.deepseek_input_usd_per_million
                + usage.get("output_tokens", 0) * settings.deepseek_output_usd_per_million
            )
            / 1_000_000,
            8,
        )
    )
    async with Session.begin() as db:
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
        }
        return turn.result


async def recover_stale_turns(all_running: bool = False) -> None:
    # Safe with a single API process: startup means the previous process has stopped.
    # A periodic lease expiry additionally handles abandoned requests.
    async with Session.begin() as db:
        query = select(Turn).where(Turn.status == "running")
        if not all_running:
            query = query.where(
                Turn.created_at < utcnow() - timedelta(seconds=settings.turn_timeout_seconds + 15)
            )
        turns = (await db.scalars(query)).all()
        for turn in turns:
            save = await owned_save(db, turn.save_id, turn.user_id, True)
            await db.refresh(turn)
            if turn.status != "running":
                continue
            turn.status = "failed"
            turn.result = {
                "turn_id": turn.id,
                "status": "failed",
                "retryable": True,
                "save": snapshot(save),
                "text": "回合已中断。已保存的行动仍然有效，请刷新进度后继续。",
            }
            turn.updated_at = utcnow()
