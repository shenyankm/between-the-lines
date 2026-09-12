import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from sqlalchemy import select, text
from starlette.middleware.sessions import SessionMiddleware

from .agents import MODEL, run_agent, run_epilogue
from .auth import current_user
from .auth import router as auth_router
from .config import get_settings
from .db import Event, Save, Session, Turn, User, engine
from .domain import STORY, initial_state
from .schemas import SaveOut, TurnInput, TurnOut
from .services import begin_turn, finish_turn, owned_save, recover_stale_turns, snapshot

settings = get_settings()
logger = logging.getLogger("btl.turns")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())


@asynccontextmanager
async def lifespan(app):
    async with AsyncConnectionPool(
        conninfo=settings.checkpoint_url,
        max_size=10,
        open=False,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": dict_row,
            "options": "-c search_path=agent_checkpoints",
        },
    ) as pool:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS agent_checkpoints"))
        await pool.wait()
        app.state.checkpointer = AsyncPostgresSaver(pool)
        await app.state.checkpointer.setup()
        app.state.active = set()
        await recover_stale_turns(all_running=True)

        async def sweep():
            while True:
                await asyncio.sleep(15)
                await recover_stale_turns()

        sweeper = asyncio.create_task(sweep())
        try:
            yield
        finally:
            sweeper.cancel()
            with suppress(asyncio.CancelledError):
                await sweeper
            await engine.dispose()


app = FastAPI(title="Between the Lines API", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="btl_oauth",
    https_only=settings.environment == "production",
)


@app.middleware("http")
async def protect_mutations(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        # Same-origin API; JSON-only mutations prevent cross-site HTML forms.
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != settings.public_origin.rstrip("/"):
            return JSONResponse({"detail": "不允许的请求来源。"}, status_code=403)
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            return JSONResponse({"detail": "需要 JSON 请求。"}, status_code=415)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(auth_router)


@app.get("/api/health")
async def health():
    async with Session() as db:
        await db.execute(text("SELECT 1"))
    return {"ok": True}


@app.get("/api/config")
async def config():
    return {
        "dev_login": settings.dev_login_enabled and settings.environment != "production",
        "zhihu_login": settings.oauth_ready,
        "agent_mode": settings.agent_mode,
        "model_ready": bool(settings.deepseek_api_key) or settings.agent_mode == "mock",
    }


@app.get("/api/story")
async def story():
    return {
        **STORY,
        "npcs": {
            key: {"name": item["name"], "role": item["role"]} for key, item in STORY["npcs"].items()
        },
    }


@app.get("/api/saves", response_model=list[SaveOut])
async def saves(user: User = Depends(current_user)):
    async with Session() as db:
        items = (
            await db.scalars(
                select(Save).where(Save.user_id == user.id).order_by(Save.created_at.desc())
            )
        ).all()
    return [snapshot(item) for item in items]


@app.post("/api/saves", response_model=SaveOut)
async def create_save(user: User = Depends(current_user)):
    async with Session.begin() as db:
        save = Save(user_id=user.id, state=initial_state())
        db.add(save)
        await db.flush()
        return snapshot(save)


@app.get("/api/saves/{save_id}", response_model=SaveOut)
async def get_save(save_id: str, user: User = Depends(current_user)):
    async with Session() as db:
        return snapshot(await owned_save(db, save_id, user.id))


@app.get("/api/saves/{save_id}/events")
async def events(save_id: str, user: User = Depends(current_user)):
    async with Session() as db:
        await owned_save(db, save_id, user.id)
        items = (
            await db.scalars(
                select(Event).where(Event.save_id == save_id).order_by(Event.created_at)
            )
        ).all()
    return [{"id": item.id, **item.data} for item in items]


@app.get("/api/saves/{save_id}/turns/{request_id}", response_model=TurnOut)
async def get_turn(save_id: str, request_id: str, user: User = Depends(current_user)):
    async with Session() as db:
        await owned_save(db, save_id, user.id)
        turn = await db.scalar(
            select(Turn).where(Turn.save_id == save_id, Turn.request_id == request_id)
        )
        if not turn:
            raise HTTPException(404, "回合不存在。")
        return {"id": turn.id, "status": turn.status, "result": turn.result, "usage": turn.usage}


def sse(event: str, data: dict):
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/api/saves/{save_id}/turns")
async def submit(
    save_id: str, body: TurnInput, request: Request, user: User = Depends(current_user)
):
    if (
        body.action == "speak"
        and settings.agent_mode == "deepseek"
        and not settings.deepseek_api_key
    ):
        raise HTTPException(503, "对话服务尚未配置，请联系管理员。")
    active = request.app.state.active
    if len(active) >= settings.max_concurrent_turns:
        raise HTTPException(429, "当前较忙，请稍后重试。")
    # Reserve a slot before awaiting database work to bound concurrent admission.
    reservation = object()
    active.add(reservation)
    try:
        turn = await begin_turn(save_id, user.id, body)
    except BaseException:
        active.discard(reservation)
        raise

    async def stream():
        usage = {
            "model": MODEL,
            "mode": settings.agent_mode,
            "model_calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }
        started = time.monotonic()
        try:
            if turn.status != "running":
                yield sse("done", turn.result or {"status": turn.status})
                return
            yield sse(
                "status",
                {
                    "turn_id": turn.id,
                    "text": "对方正在回复…" if body.action == "speak" else "正在保存行动…",
                },
            )
            reply = ""
            async with asyncio.timeout(settings.turn_timeout_seconds):
                if body.action == "speak":
                    async for chunk in run_agent(turn, request.app.state.checkpointer, usage):
                        reply += chunk
                elif body.action in {"next", "leave", "epilogue"}:
                    async with Session() as db:
                        final_save = await owned_save(db, save_id, user.id)
                    if final_save.state["ending"]:
                        reply = await run_epilogue(final_save.state, usage)
            usage["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            usage["cost_estimate_usd"] = (
                0.0
                if settings.agent_mode == "mock"
                else round(
                    (
                        usage["input_tokens"] * settings.deepseek_input_usd_per_million
                        + usage["output_tokens"] * settings.deepseek_output_usd_per_million
                    )
                    / 1_000_000,
                    8,
                )
            )
            result = await finish_turn(turn.id, reply, usage)
            # Stream only after the reply has been committed, so disconnects are recoverable.
            if reply:
                yield sse("dialogue", {"npc": body.npc, "text": reply})
            yield sse("done", result)
        except asyncio.CancelledError:
            usage["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            await asyncio.shield(
                finish_turn(turn.id, "连接中断，已保存的行动仍然有效。", usage, True)
            )
            raise
        except Exception as exc:
            usage["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            logger.warning("turn_failed id=%s kind=%s", turn.id, type(exc).__name__)
            result = await finish_turn(
                turn.id, "本次回复未完成，已保存的行动仍然有效。请刷新后继续。", usage, True
            )
            yield sse("done", result)
        finally:
            active.discard(reservation)
            logger.info("turn_finished id=%s npc=%s usage=%s", turn.id, body.npc, json.dumps(usage))

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )
