"""HTTP adapters for the single-story application."""

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import literal, select, tuple_

from ..auth import current_user
from ..db import Event, Save, Turn, User
from ..errors import (
    AUTH_RESPONSES,
    MUTATION_RESPONSES,
    SAVE_RESPONSES,
    SUBMIT_RESPONSES,
    TURN_RESPONSES,
    ApiError,
)
from ..game_types import Channel, Npc, initial_v3
from ..logging_setup import request_id as correlation_id
from ..product import check_save_capacity, record_product_event
from ..runtime import runtime_for
from ..schemas import (
    ConfigOut,
    CreateSaveInput,
    GameEventOut,
    PlayStateOut,
    SaveOut,
    StreamErrorEvent,
    TurnInput,
    TurnOut,
    TurnResult,
)
from ..services import owned_save, snapshot
from ..story import StoryOut, load_story

router = APIRouter()


@router.get("/api/config", response_model=ConfigOut)
async def config(request: Request) -> dict[str, Any]:
    return {
        "guest_login": runtime_for(request).settings.guest_enabled,
        "guest_full_story": runtime_for(request).settings.guest_full_story_enabled,
        "story_version": 3,
        "dev_login": runtime_for(request).settings.dev_login_enabled
        and runtime_for(request).settings.environment != "production",
        "zhihu_login": runtime_for(request).settings.oauth_ready,
        "agent_mode": runtime_for(request).settings.agent_mode,
        "model_ready": runtime_for(request).settings.model_ready,
    }


@router.get("/api/story", response_model=StoryOut, responses=SAVE_RESPONSES)
async def story(
    request: Request,
    response: Response,
    version: int = Query(default=3, ge=1, le=3),
    story_id: str = "workplace-s1",
    revision: int = Query(default=2, ge=1, le=2),
) -> StoryOut | Response:
    if story_id != "workplace-s1":
        raise ApiError(404, "not_found")
    definition = load_story(version, revision).public()
    response.headers["ETag"] = (
        '"' + hashlib.sha256(definition.model_dump_json().encode()).hexdigest() + '"'
    )
    if request.headers.get("if-none-match") == response.headers["ETag"]:
        return Response(status_code=304, headers={"ETag": response.headers["ETag"]})
    return definition


@router.get(
    "/api/saves",
    response_model=list[SaveOut],
    responses={**AUTH_RESPONSES, 409: SAVE_RESPONSES[409]},
)
async def saves(request: Request, user: User = Depends(current_user)) -> list[dict[str, Any]]:
    async with runtime_for(request).sessions() as db:
        items = (
            await db.scalars(
                select(Save)
                .where(Save.user_id == user.id)
                .order_by(Save.last_played_at.desc(), Save.id.desc())
            )
        ).all()
    return [snapshot(item) for item in items]


@router.post(
    "/api/saves", response_model=SaveOut, responses={**MUTATION_RESPONSES, **SAVE_RESPONSES}
)
async def create_save(
    request: Request, body: CreateSaveInput, user: User = Depends(current_user)
) -> dict[str, Any]:
    async with runtime_for(request).sessions.begin() as db:
        await db.scalar(select(User).where(User.id == user.id).with_for_update())
        settings = runtime_for(request).settings
        await check_save_capacity(db, user, settings.active_save_limit)
        version = body.story_version or 3
        if version != 3:
            raise ApiError(422, "rule_violation", "新建故事仅支持 v3，旧档仍可阅读。")
        state = initial_v3().model_dump(mode="json")
        save = Save(
            user_id=user.id, state=state, story_version=version, state_schema_version=version
        )
        db.add(save)
        await db.flush()
        return snapshot(save)


@router.get("/api/saves/{save_id}", response_model=SaveOut, responses=SAVE_RESPONSES)
async def get_save(
    save_id: UUID, request: Request, user: User = Depends(current_user)
) -> dict[str, Any]:
    async with runtime_for(request).sessions() as db:
        return snapshot(await owned_save(db, str(save_id), user.id))


@router.get(
    "/api/saves/{save_id}/events", response_model=list[GameEventOut], responses=SAVE_RESPONSES
)
async def events(
    save_id: UUID,
    request: Request,
    user: User = Depends(current_user),
    before: UUID | None = None,
    channel: Channel | None = None,
    target: Npc | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> list[dict[str, Any]]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, str(save_id), user.id)
        query = select(Event).where(Event.save_id == str(save_id))
        if channel:
            query = query.where(Event.data["channel"].astext == channel)
        if target:
            query = query.where(Event.data["npc"].astext == target)
        if before:
            cursor = await db.get(Event, str(before))
            if not cursor or cursor.save_id != str(save_id):
                raise ApiError(404, "not_found")
            query = query.where(
                tuple_(Event.created_at, Event.id)
                < tuple_(literal(cursor.created_at), literal(cursor.id))
            )
        items = list(
            reversed(
                (
                    await db.scalars(
                        query.order_by(Event.created_at.desc(), Event.id.desc()).limit(limit)
                    )
                ).all()
            )
        )
    return [{"id": item.id, **item.data} for item in items]


@router.get(
    "/api/saves/{save_id}/events/{event_id}", response_model=GameEventOut, responses=SAVE_RESPONSES
)
async def event_detail(
    save_id: UUID, event_id: UUID, request: Request, user: User = Depends(current_user)
) -> dict[str, Any]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, str(save_id), user.id)
        item = await db.get(Event, str(event_id))
        if item is None or item.save_id != str(save_id):
            raise ApiError(404, "not_found")
        return {"id": item.id, **item.data}


@router.get(
    "/api/saves/{save_id}/turns/{request_id}",
    response_model=TurnOut,
    responses=TURN_RESPONSES,
)
async def get_turn(
    save_id: UUID, request_id: UUID, request: Request, user: User = Depends(current_user)
) -> dict[str, Any]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, str(save_id), user.id)
        turn = await db.scalar(
            select(Turn).where(Turn.save_id == str(save_id), Turn.request_id == str(request_id))
        )
        if not turn:
            raise ApiError(404, "turn_not_found")
        output = {"id": turn.id, "status": turn.status, "result": turn.result, "usage": turn.usage}
    if turn.status != "running":
        await record_product_event(
            runtime_for(request).sessions,
            user.id,
            "recovery_completed" if turn.status == "completed" else "recovery_failed",
            turn.id,
        )
    return output


@router.get(
    "/api/saves/{save_id}/play-state", response_model=PlayStateOut, responses=SAVE_RESPONSES
)
async def play_state(
    save_id: UUID, request: Request, user: User = Depends(current_user)
) -> PlayStateOut:
    return await runtime_for(request).service.play_state(str(save_id), user.id)


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post(
    "/api/saves/{save_id}/turns", responses=SUBMIT_RESPONSES, response_class=StreamingResponse
)
async def submit(
    save_id: UUID, body: TurnInput, request: Request, user: User = Depends(current_user)
) -> StreamingResponse:
    runtime = runtime_for(request)
    try:
        turn_id, result = await runtime.runner.submit(str(save_id), user.id, body)
    except ApiError as exc:
        if exc.code == "rule_violation" and body.action in {"approve_purchase", "joint_review"}:
            await record_product_event(
                runtime.sessions, user.id, "approval_stuck", str(body.request_id)
            )
        raise

    async def stream() -> AsyncIterator[str]:
        yield sse(
            "status",
            {
                "turn_id": turn_id,
                "text": "对方正在回复…" if body.action == "speak" else "正在保存行动…",
            },
        )
        try:
            previous = ""
            while not result.done():
                preview = runtime.runner.live_replies.get(turn_id, "")
                if preview != previous:
                    yield sse("dialogue", {"npc": body.npc, "text": preview})
                    previous = preview
                # asyncio.wait leaves the owned task running on disconnect/timeout.
                await asyncio.wait({result}, timeout=0.03)
            raw = await asyncio.shield(result)
            final = TurnResult.model_validate(raw).model_dump(mode="json")
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger("btl.stream").warning(
                "subscription_failed",
                extra={"fields": {"turn_id": turn_id, "code": "subscription_failed"}},
            )
            yield sse(
                "error",
                StreamErrorEvent(turn_id=turn_id, request_id=correlation_id.get()).model_dump(
                    mode="json"
                ),
            )
            return
        if final:
            final_text = final.get("text", "") if final.get("status") == "completed" else ""
            if final_text != previous:
                yield sse("dialogue", {"npc": body.npc, "text": final_text})
        yield sse("done", final)

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )


class ReadingInput(BaseModel):
    key: str = Field(
        pattern=r"^(prologue|act_[123](_follow_up|_invitation|_farewell)?|dm_(sun|li|zhang|wang)|group|work)$"
    )
    position: int = Field(ge=0, le=1000000)


@router.post(
    "/api/saves/{save_id}/reading", response_model=dict[str, int], responses=SAVE_RESPONSES
)
async def reading(
    save_id: UUID, body: ReadingInput, request: Request, user: User = Depends(current_user)
) -> dict[str, int]:
    async with runtime_for(request).sessions.begin() as db:
        save = await owned_save(db, str(save_id), user.id, True)
        save.reading = {**save.reading, body.key: max(save.reading.get(body.key, 0), body.position)}
        return save.reading
