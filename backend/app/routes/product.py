"""Versioned product features exposed alongside the existing turn protocol."""

import re
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from ..auth import current_player
from ..db import AIJob, ProductEvent, Save, SaveSnapshot, Turn, User, utcnow
from ..errors import PLAYER_MUTATION_RESPONSES as MUTATION_RESPONSES
from ..errors import SAVE_RESPONSES, SUBMIT_RESPONSES, ApiError
from ..product import branch_save, check_save_capacity, rate_limit, record_product_event
from ..runtime import runtime_for
from ..schemas import (
    BranchInput,
    DiagnosticInput,
    FeedbackInput,
    JobInput,
    JobOut,
    ProductEventInput,
    SaveManagement,
    SaveOut,
    SnapshotOut,
)
from ..services import owned_save, snapshot

router = APIRouter(responses=SAVE_RESPONSES)


@router.post("/api/saves/{save_id}/visit", response_model=SaveOut, responses=MUTATION_RESPONSES)
async def visit(
    save_id: UUID, request: Request, user: User = Depends(current_player)
) -> dict[str, Any]:
    async with runtime_for(request).sessions.begin() as db:
        save = await owned_save(db, str(save_id), user.id, True)
        save.last_played_at = utcnow()
        return snapshot(save)


@router.post("/api/saves/{save_id}/manage", response_model=SaveOut, responses=MUTATION_RESPONSES)
async def manage(
    save_id: UUID, body: SaveManagement, request: Request, user: User = Depends(current_player)
) -> dict[str, Any]:
    runtime = runtime_for(request)
    async with runtime.sessions.begin() as db:
        await db.scalar(select(User).where(User.id == user.id).with_for_update())
        save = await db.scalar(
            select(Save).where(Save.id == str(save_id), Save.user_id == user.id).with_for_update()
        )
        if not save:
            raise ApiError(404, "save_not_found")
        active = await db.scalar(
            select(Turn.id).where(Turn.save_id == save.id, Turn.status == "running")
        )
        job = await db.scalar(
            select(AIJob.id).where(AIJob.save_id == save.id, AIJob.status == "running").limit(1)
        )
        if active or job:
            raise ApiError(409, "save_busy")
        if user.identity_type != "guest" and body.operation == "restore" and save.deleted_at:
            await check_save_capacity(db, user, runtime.settings.active_save_limit)
        if body.operation == "delete":
            save.deleted_at = save.deleted_at or utcnow()
        else:
            save.deleted_at = None
        return snapshot(save)


@router.get("/api/saves/{save_id}/snapshots", response_model=list[SnapshotOut])
async def snapshots(
    save_id: UUID, request: Request, user: User = Depends(current_player)
) -> list[dict[str, Any]]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, str(save_id), user.id)
        points = (
            await db.scalars(
                select(SaveSnapshot)
                .where(SaveSnapshot.save_id == str(save_id))
                .order_by(SaveSnapshot.created_at)
            )
        ).all()
        return [{"id": p.id, "node": p.node, "created_at": p.created_at} for p in points]


@router.post("/api/saves/{save_id}/branches", response_model=SaveOut, responses=MUTATION_RESPONSES)
async def branch(
    save_id: UUID, body: BranchInput, request: Request, user: User = Depends(current_player)
) -> dict[str, Any]:
    runtime = runtime_for(request)
    async with runtime.sessions.begin() as db:
        await db.scalar(select(User).where(User.id == user.id).with_for_update())
        source = await owned_save(db, str(save_id), user.id, True)
        return snapshot(
            await branch_save(db, user, source, body, runtime.settings.active_save_limit)
        )


def job_out(job: AIJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "act": job.payload.get("act"),
        "kind": job.kind,
        "status": job.status,
        "result": job.result,
    }


@router.post("/api/saves/{save_id}/jobs", response_model=JobOut, responses=SUBMIT_RESPONSES)
async def create_job(
    save_id: UUID, body: JobInput, request: Request, user: User = Depends(current_player)
) -> dict[str, Any]:
    return job_out(await runtime_for(request).jobs.submit(str(save_id), user.id, body))


@router.get("/api/saves/{save_id}/jobs", response_model=list[JobOut])
async def jobs(
    save_id: UUID, request: Request, user: User = Depends(current_player)
) -> list[dict[str, Any]]:
    async with runtime_for(request).sessions() as db:
        await owned_save(db, str(save_id), user.id)
        rows = (
            await db.scalars(
                select(AIJob)
                .where(AIJob.save_id == str(save_id), AIJob.kind != "turn")
                .order_by(AIJob.created_at.desc())
                .limit(30)
            )
        ).all()
        output = [job_out(job) for job in rows]
    for job in rows:
        if job.kind == "reflection" and job.status != "running":
            await record_product_event(
                runtime_for(request).sessions, user.id, "recap_viewed", job.id
            )
    return output


@router.post("/api/diagnostics", response_model=dict[str, bool], responses=MUTATION_RESPONSES)
async def diagnostic(
    body: DiagnosticInput, request: Request, user: User = Depends(current_player)
) -> dict[str, bool]:
    async with runtime_for(request).sessions.begin() as db:
        await rate_limit(db, "diagnostics:" + user.id, 20, 60)
        data = body.model_dump(exclude_none=True)
        # Keep only static bundle positions. Never accept error message bodies,
        # URLs with parameters, arbitrary stack text, or user-provided filenames.
        data["stack"] = "\n".join(
            re.findall(r"/assets/[A-Za-z0-9_-]+\.js:\d+:\d+", body.stack or "")[:10]
        )
        db.add(ProductEvent(user_id=user.id, name="diagnostic", data=data))
    return {"ok": True}


@router.post("/api/feedback", response_model=dict[str, bool], responses=MUTATION_RESPONSES)
async def feedback(
    body: FeedbackInput, request: Request, user: User = Depends(current_player)
) -> dict[str, bool]:
    async with runtime_for(request).sessions.begin() as db:
        await rate_limit(db, "feedback:" + user.id, 5, 3600)
        db.add(ProductEvent(user_id=user.id, name="feedback", data={"text": body.text}))
    return {"ok": True}


@router.post("/api/product-events", response_model=dict[str, bool], responses=MUTATION_RESPONSES)
async def product_event(
    body: ProductEventInput, request: Request, user: User = Depends(current_player)
) -> dict[str, bool]:
    async with runtime_for(request).sessions.begin() as db:
        await rate_limit(db, "analytics:" + user.id, 60, 60)
        db.add(ProductEvent(user_id=user.id, name=body.name, data={}))
    return {"ok": True}
