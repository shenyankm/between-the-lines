"""Composition root. Lifespan owns all connections and background tasks."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any, cast

from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI, Request
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from sqlalchemy import text
from starlette.middleware.base import RequestResponseEndpoint
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response

from .agents import AgentGateway
from .auth import router as auth_router
from .config import Settings
from .errors import ERROR_RESPONSES, error_response, install
from .jobs import JobRunner
from .logging_setup import RequestIdMiddleware, configure_logging
from .metrics import Metrics
from .product import process_bindings
from .routes.game import router as game_router
from .routes.health import router as health_router
from .routes.product import router as product_router
from .runner import TurnRunner
from .runtime import Dependencies, Runtime
from .schemas import DialogueEvent, StatusEvent, StreamErrorEvent, TurnResult
from .services import GameService
from .storage import Database
from .story import load_story

SINGLE_INSTANCE_LOCK = 7284601001


def create_app(settings: Settings, dependencies: Dependencies | None = None) -> FastAPI:
    dependencies = dependencies or Dependencies()
    story = load_story()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(settings)
        database = Database(settings)
        engine = database.engine
        try:
            async with engine.connect() as lease:
                acquired = await lease.scalar(
                    text("SELECT pg_try_advisory_lock(:key)"), {"key": SINGLE_INSTANCE_LOCK}
                )
                await lease.commit()
                if not acquired:
                    raise RuntimeError("Another API instance owns this database")
                try:
                    async with engine.begin() as conn:
                        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS agent_checkpoints"))
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
                    ) as untyped_pool:
                        await untyped_pool.wait()
                        pool = cast(
                            "AsyncConnectionPool[AsyncConnection[dict[str, Any]]]", untyped_pool
                        )
                        checkpointer = AsyncPostgresSaver(pool)
                        await checkpointer.setup()
                        sessions = database.sessions
                        service = GameService(sessions, settings)
                        gateway = AgentGateway(settings, service, story)
                        metrics = Metrics()
                        runner = TurnRunner(
                            settings,
                            service,
                            checkpointer,
                            lambda *args: (dependencies.reply or gateway.run_agent)(*args),
                            lambda *args: (dependencies.epilogue or gateway.run_epilogue)(*args),
                            metrics.observe_turn,
                        )
                        oauth = OAuth()  # type: ignore[no-untyped-call]  # authlib lacks stubs
                        if settings.oauth_ready:
                            oauth.register(
                                "zhihu",
                                client_id=settings.zhihu_client_id,  # type: ignore[no-untyped-call]  # authlib lacks stubs
                                client_secret=settings.zhihu_client_secret,
                                authorize_url=settings.zhihu_authorize_url,
                                access_token_url=settings.zhihu_token_url,
                                client_kwargs={"scope": settings.zhihu_scope},
                            )
                        jobs = JobRunner(service)
                        jobs.active = runner.active
                        app.state.runtime = Runtime(
                            settings,
                            story,
                            sessions,
                            service,
                            checkpointer,
                            pool,
                            runner,
                            metrics,
                            oauth,
                            jobs,
                        )
                        await service.recover_stale_turns(all_running=True)
                        await jobs.recover()
                        await process_bindings(sessions)

                        async def sweep() -> None:
                            while True:
                                await asyncio.sleep(15)
                                try:
                                    await service.recover_stale_turns()
                                    await jobs.recover(all_running=False)
                                    await process_bindings(sessions)
                                except Exception:
                                    logging.getLogger("btl.recovery").error("recovery_deferred")

                        sweeper = asyncio.create_task(sweep())
                        try:
                            yield
                        finally:
                            await runner.close()
                            await jobs.close()
                            sweeper.cancel()
                            with suppress(asyncio.CancelledError):
                                await sweeper
                finally:
                    await lease.execute(
                        text("SELECT pg_advisory_unlock(:key)"), {"key": SINGLE_INSTANCE_LOCK}
                    )
                    await lease.commit()
        finally:
            await database.close()

    production = settings.environment == "production"
    app = FastAPI(
        title="章外回声 API",
        lifespan=lifespan,
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
        responses=ERROR_RESPONSES,
    )
    app.state.settings, app.state.dependencies = settings, dependencies
    install(app)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="btl_oauth",
        https_only=production,
    )

    @app.middleware("http")
    async def protect_mutations(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") != settings.public_origin.rstrip("/"):
                return error_response(403, "forbidden_origin", None, request)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return error_response(415, "json_required", None, request)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = (
                "public, max-age=0, must-revalidate"
                if request.url.path == "/api/story" and response.status_code in {200, 304}
                else "no-store"
            )
        return response

    app.add_middleware(RequestIdMiddleware)
    app.include_router(auth_router)
    app.include_router(health_router)
    app.include_router(game_router)
    app.include_router(product_router)
    original_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        schema = original_openapi()
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        for model in (StatusEvent, DialogueEvent, TurnResult, StreamErrorEvent):
            definition = model.model_json_schema(ref_template="#/components/schemas/{model}")
            components.update(definition.pop("$defs", {}))
            if model is TurnResult:
                definition["properties"]["proposal"].pop("default", None)
            components[model.__name__] = definition
        response = schema["paths"]["/api/saves/{save_id}/turns"]["post"]["responses"]["200"]
        response["description"] = (
            "SSE: status=StatusEvent, dialogue=DialogueEvent, done=TurnResult, error=StreamErrorEvent (subscription failed; query the original request). Only committed dialogue is public."
        )
        response["headers"] = {
            "X-Request-Id": {"schema": {"type": "string"}},
            "Cache-Control": {"schema": {"type": "string"}, "description": "no-store"},
        }
        response["content"] = {"text/event-stream": {"schema": {"type": "string"}}}
        return schema

    app.openapi = openapi  # type: ignore[method-assign]  # FastAPI's custom schema hook
    return app
