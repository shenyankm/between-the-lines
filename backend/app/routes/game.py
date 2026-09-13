"""HTTP adapters for the single-story application."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from ..auth import current_user
from ..db import Event, Save, Turn, User
from ..domain import ACTION_TARGETS, initial_state
from ..errors import (
    AUTH_RESPONSES,
    MUTATION_RESPONSES,
    SAVE_RESPONSES,
    SUBMIT_RESPONSES,
    TURN_RESPONSES,
    ApiError,
)
from ..runtime import runtime_for
from ..schemas import ConfigOut, GameEventOut, PlayStateOut, SaveOut, TurnInput, TurnOut, TurnResult
from ..services import owned_save, snapshot
from ..story import StoryOut

router = APIRouter()


@router.get("/api/config", response_model=ConfigOut)
async def config(request: Request) -> dict[str, Any]:
    return {
        "dev_login": runtime_for(request).settings.dev_login_enabled
        and runtime_for(request).settings.environment != "production",
        "zhihu_login": runtime_for(request).settings.oauth_ready,
        "agent_mode": runtime_for(request).settings.agent_mode,
        "model_ready": runtime_for(request).settings.model_ready,
    }


@router.get("/api/story", response_model=StoryOut)
async def story(request: Request) -> StoryOut:
    return runtime_for(request).story.public()


@router.get("/api/saves", response_model=list[SaveOut], responses=AUTH_RESPONSES)
async def saves(request: Request, user: User = Depends(current_user)) -> list[dict[str, Any]]:
    async with runtime_for(request).sessions() as db:
        items = (
            await db.scalars(
                select(Save).where(Save.user_id == user.id).order_by(Save.created_at.desc())
            )
        ).all()
    return [snapshot(item) for item in items]


@router.post(
    "/api/saves", response_model=SaveOut, responses={**MUTATION_RESPONSES, **AUTH_RESPONSES}
)
async def create_save(request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    async with runtime_for(request).sessions.begin() as db:
        save = Save(user_id=user.id, state=initial_state().model_dump(mode="json"))
        db.add(save)
        await db.flush()
        return snapshot(save)


@router.get("/api/saves/{save_id}", response_model=SaveOut, responses=SAVE_RESPONSES)
async def get_save(
    save_id: str, request: Request, user: User = Depends(current_user)
) -> dict[str, Any]:
    async with runtime_for(request).sessions() as db:
        return snapshot(await owned_save(db, save_id, user.id))


@router.get(
    "/api/saves/{save_id}/events", response_model=list[GameEventOut], responses=SAVE_RESPONSES
)
async def events(
    save_id: str, request: Request, user: User = Depends(current_user)
) -> list[dict[str, Any]]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, save_id, user.id)
        items = (
            await db.scalars(
                select(Event).where(Event.save_id == save_id).order_by(Event.created_at, Event.id)
            )
        ).all()
    return [{"id": item.id, **item.data} for item in items]


@router.get(
    "/api/saves/{save_id}/turns/{request_id}",
    response_model=TurnOut,
    responses=TURN_RESPONSES,
)
async def get_turn(
    save_id: str, request_id: str, request: Request, user: User = Depends(current_user)
) -> dict[str, Any]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, save_id, user.id)
        turn = await db.scalar(
            select(Turn).where(Turn.save_id == save_id, Turn.request_id == request_id)
        )
        if not turn:
            raise ApiError(404, "turn_not_found", "回合不存在。")
        return {"id": turn.id, "status": turn.status, "result": turn.result, "usage": turn.usage}


@router.get(
    "/api/saves/{save_id}/play-state", response_model=PlayStateOut, responses=SAVE_RESPONSES
)
async def play_state(
    save_id: str, request: Request, user: User = Depends(current_user)
) -> PlayStateOut:
    return await runtime_for(request).service.play_state(save_id, user.id)


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post(
    "/api/saves/{save_id}/turns", responses=SUBMIT_RESPONSES, response_class=StreamingResponse
)
async def submit(
    save_id: str, body: TurnInput, request: Request, user: User = Depends(current_user)
) -> StreamingResponse:
    runtime = runtime_for(request)
    turn_id, result = await runtime.runner.submit(save_id, user.id, body)

    async def stream() -> AsyncIterator[str]:
        yield sse(
            "status",
            {
                "turn_id": turn_id,
                "text": "对方正在回复…"
                if body.action == "speak" or body.action in ACTION_TARGETS
                else "正在保存行动…",
            },
        )
        previous = ""
        while not result.done():
            preview = runtime.runner.live_replies.get(turn_id, "")
            if preview and preview != previous:
                yield sse("preview", {"npc": body.npc, "text": preview})
                previous = preview
            # Waiting on the task without cancelling it preserves disconnect recovery.
            await asyncio.wait({result}, timeout=0.05)
        raw = await asyncio.shield(result)
        final = TurnResult.model_validate(raw).model_dump(mode="json")
        if final and final.get("status") == "completed" and final.get("text"):
            yield sse(
                "dialogue",
                {"npc": ACTION_TARGETS.get(body.action, body.npc), "text": final["text"]},
            )
        yield sse("done", final)

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )
