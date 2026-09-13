"""Durable AI admission. Reservations survive unknown provider usage."""

from datetime import timedelta
from typing import Any

from sqlalchemy import Numeric, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .db import AIJob, AISpend, Turn, User, utcnow
from .errors import ApiError


def reservation(settings: Settings, calls: int = 4) -> float:
    # UTF-8 bytes bound token count conservatively; enforce that byte limit before requests.
    return round(
        calls
        * (1 + settings.deepseek_max_retries)
        * (
            settings.ai_input_byte_limit * settings.deepseek_input_usd_per_million
            + 800 * settings.deepseek_output_usd_per_million
        )
        / 1_000_000,
        8,
    )


async def monthly_commitment(db: AsyncSession) -> float:
    month = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    spent = (
        await db.scalar(
            select(func.coalesce(func.sum(AISpend.cost_usd + AISpend.reserved_usd), 0)).where(
                AISpend.created_at >= month
            )
        )
        or 0
    )
    # Legacy rows not represented by jobs still contribute; new turn jobs use turn id as id.
    legacy = (
        await db.scalar(
            select(
                func.coalesce(func.sum(Turn.usage["cost_estimate_usd"].astext.cast(Numeric)), 0)
            ).where(
                Turn.created_at >= month,
                ~select(AISpend.id).where(AISpend.id == Turn.id).exists(),
            )
        )
        or 0
    )
    return float(spent) + float(legacy)


async def reserve_job(
    db: AsyncSession,
    settings: Settings,
    user: User,
    save_id: str,
    request: str,
    kind: str,
    payload: dict[str, Any],
    job_id: str | None = None,
) -> AIJob:
    now = utcnow()
    since = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # All callers lock the user first; the global budget lock is always acquired last.
    await db.execute(text("SELECT pg_advisory_xact_lock(7284601002)"))
    count = (
        await db.scalar(
            select(func.count())
            .select_from(AISpend)
            .where(
                AISpend.user_id == user.id,
                *([] if user.identity_type == "guest" else [AISpend.created_at >= since]),
            )
        )
        or 0
    )
    limit = settings.guest_ai_limit if user.identity_type == "guest" else settings.daily_turn_limit
    if count >= limit:
        raise ApiError(
            429,
            "daily_limit_reached",
            headers={
                "Retry-After": str(
                    max(
                        1,
                        int(
                            (
                                (
                                    user.guest_expires_at or since + timedelta(days=1)
                                    if user.identity_type == "guest"
                                    else since + timedelta(days=1)
                                )
                                - now
                            ).total_seconds()
                        ),
                    )
                )
            },
        )
    amount = (
        0.0
        if settings.agent_mode == "mock"
        else reservation(settings, settings.max_model_calls if kind == "turn" else 2)
    )
    if settings.agent_mode != "mock":
        if not settings.deepseek_api_key:
            raise ApiError(503, "model_unconfigured")
        spent = await monthly_commitment(db)
        if settings.monthly_cost_cap_usd > 0 and spent + amount > settings.monthly_cost_cap_usd:
            raise ApiError(503, "monthly_cost_cap_reached")
    job = AIJob(
        request_id=request,
        user_id=user.id,
        save_id=save_id,
        kind=kind,
        payload=payload,
        reserved_usd=amount,
    )
    if job_id:
        job.id = job_id
    db.add(job)
    await db.flush()
    db.add(AISpend(id=job.id, user_id=user.id, save_id=save_id, kind=kind, reserved_usd=amount))
    return job


async def settle(
    db: AsyncSession, job: AIJob, settings: Settings, usage: dict[str, Any], failed: bool
) -> None:
    cost = (
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
    job.cost_usd = cost
    job.reserved_usd = max(0, job.reserved_usd - cost) if failed else 0
    job.status = (
        "unknown"
        if failed and settings.agent_mode != "mock"
        else "failed"
        if failed
        else "completed"
    )
    job.usage = usage

    ledger = await db.get(AISpend, job.id)
    if ledger:
        ledger.cost_usd, ledger.reserved_usd, ledger.status = (
            job.cost_usd,
            job.reserved_usd,
            job.status,
        )
