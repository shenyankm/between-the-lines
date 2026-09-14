"""Persist AI execution identity independently of provider accounting."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .db import AIJob, User
from .errors import ApiError


async def create_job(
    db: AsyncSession,
    settings: Settings,
    user: User,
    save_id: str,
    request: str,
    kind: str,
    payload: dict[str, Any],
    job_id: str | None = None,
) -> AIJob:
    if settings.agent_mode != "mock" and not settings.deepseek_api_key:
        raise ApiError(503, "model_unconfigured")
    job = AIJob(request_id=request, user_id=user.id, save_id=save_id, kind=kind, payload=payload)
    if job_id:
        job.id = job_id
    db.add(job)
    await db.flush()
    return job
