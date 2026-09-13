"""Liveness, readiness and metrics.

`/api/health` stays exactly as it was: the container healthcheck, the compose
`service_healthy` gate and CI's mock-mode assertion all call it. `/api/live` and
`/api/ready` split apart what it conflated. A restart policy needs "is this
process wedged", and anything routing traffic needs "can this serve a turn";
answering both with one database query means either restarting a healthy process
because the database blipped, or sending a turn to one whose checkpoint pool is
exhausted.

`/metrics` deliberately lives outside `/api/`. nginx proxies only `location /api/`,
so the endpoint is unreachable from outside the compose network by construction;
`deploy/nginx.conf` also denies the path explicitly, because relying on a
catch-all proxy staying narrow is not a control.
"""

import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text

from ..metrics import Metrics
from ..runtime import runtime_for
from ..schemas import LiveOut, ReadyOut

logger = logging.getLogger("btl.health")
router = APIRouter()

# A readiness probe that blocks longer than the orchestrator's own timeout is
# worse than one that reports failure: it turns "degraded" into "unreachable".
_PROBE_TIMEOUT_SECONDS = 2.0


@router.get("/api/health")
async def health(request: Request) -> dict[str, bool]:
    async with runtime_for(request).sessions() as db:
        await db.execute(text("SELECT 1"))
    return {"ok": True}


@router.get("/api/live")
async def live() -> LiveOut:
    """No I/O of any kind. If this can answer, the event loop is not wedged."""
    return LiveOut()


@router.get(
    "/api/ready",
    response_model=ReadyOut,
    # Declared because the route returns a Response instance, which FastAPI cannot
    # introspect: without this the contract showed an empty 200 schema and no 503
    # at all, contradicting the only thing this endpoint exists to report.
    responses={503: {"model": ReadyOut, "description": "至少一项依赖不可用。"}},
)
async def ready(request: Request) -> JSONResponse:
    if not hasattr(request.app.state, "runtime"):
        return JSONResponse(
            ReadyOut(
                status="not_ready", checks={"database": "error", "checkpoint_pool": "error"}
            ).model_dump(),
            503,
        )
    checks: dict[str, str] = {}
    try:
        async with asyncio.timeout(_PROBE_TIMEOUT_SECONDS), runtime_for(request).sessions() as db:
            await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        # The traceback goes to the log. The response says only which dependency
        # failed, because a database error string can carry a DSN fragment.
        logger.exception("readiness_failed check=database")
        checks["database"] = "error"

    pool = getattr(runtime_for(request), "checkpoint_pool", None)
    if pool is None:
        logger.error("readiness_failed check=checkpoint_pool reason=not_initialised")
        checks["checkpoint_pool"] = "error"
    else:
        try:
            # Acquiring a connection and querying through it proves the pool has
            # capacity, not merely that the object exists -- an exhausted pool is
            # the failure mode that actually stops turns from running.
            async with pool.connection(timeout=_PROBE_TIMEOUT_SECONDS) as conn:
                await conn.execute("SELECT 1")
            checks["checkpoint_pool"] = "ok"
        except Exception:
            logger.exception("readiness_failed check=checkpoint_pool")
            checks["checkpoint_pool"] = "error"

    ready_now = all(value == "ok" for value in checks.values())
    body = ReadyOut(status="ready" if ready_now else "not_ready", checks=checks)
    return JSONResponse(body.model_dump(), 200 if ready_now else 503)


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    # A scraper must never receive a 500 from the endpoint it uses to detect
    # trouble, so the gauge falls back to zero if the lifespan has not run yet.
    if not hasattr(request.app.state, "runtime"):
        return PlainTextResponse(Metrics().render(0), media_type="text/plain; version=0.0.4")
    active = getattr(runtime_for(request).runner, "active", ())
    return PlainTextResponse(
        runtime_for(request).metrics.render(len(active)), media_type="text/plain; version=0.0.4"
    )
