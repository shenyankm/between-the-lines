"""Real request admission and persistence beyond every removed cumulative quota."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select
from test_product_v2 import act, confirm, create

from app.db import AIJob, RateBucket, Turn

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("identity,count", [("dev", 101), ("guest", 9)])
async def test_ai_turns_continue_past_old_quotas(app, monkeypatch, identity, count):
    calls = 0

    async def reply(turn, checkpointer):
        nonlocal calls
        calls += 1
        yield "听到了。"

    monkeypatch.setattr(app.state.dependencies, "reply", reply)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        assert (await c.post(f"/api/auth/{identity}", json={})).status_code == 200
        assert "ai_remaining" not in (await c.get("/api/auth/me")).json()
        save = await create(c)
        await act(c, save, "begin")
        # Use deepseek admission with a fixture adapter: no actual provider traffic.
        app.state.settings.agent_mode = "deepseek"
        app.state.settings.deepseek_api_key = "fixture"
        for _ in range(count):
            result, body = await act(c, save, "speak", text="你好。")
        assert calls == count
        again = await c.post(f"/api/saves/{save['id']}/turns", json=body)
        assert again.status_code == 200 and calls == count
        old = (await c.get(f"/api/saves/{save['id']}/turns/{body['request_id']}")).json()
        assert old["result"]["turn_id"] == result["turn_id"] and "usage" not in old
        assert (await c.get(f"/api/saves/{save['id']}/play-state")).json()["ai"] == {
            "available": True,
            "reason": None,
        }
        async with app.state.runtime.sessions() as db:
            assert await db.scalar(select(func.count()).select_from(AIJob)) == count
            assert not await db.scalar(
                select(func.count()).select_from(RateBucket).where(RateBucket.key.like("turn:%"))
            )
            assert (await db.get(Turn, result["turn_id"])).elapsed_ms >= 0


async def test_artifact_generations_continue_past_minute_and_daily_limits(app, monkeypatch):
    calls = 0

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        await c.post("/api/auth/dev", json={})
        save = await create(c)
        await act(c, save, "begin")
        await act(c, save, "draft_exit", params={"kind": "resign", "reason": "更换工作环境"})
        await confirm(c, save, "leave")
        runtime = app.state.runtime
        runtime.settings.agent_mode = "deepseek"
        runtime.settings.deepseek_api_key = "fixture"

        async def generate(kind, payload):
            nonlocal calls
            calls += 1
            return {
                "nodes": [
                    {
                        "event_id": fact["event_id"],
                        "actor": "player",
                        "alternative": "先说明需要。",
                        "possible_cost": "需要时间。",
                    }
                    for fact in payload["facts"]
                ]
            }

        monkeypatch.setattr(runtime.jobs, "generate", generate)
        for _ in range(101):
            body = {"kind": "reflection", "version": save["version"], "request_id": str(uuid4())}
            response = await c.post(f"/api/saves/{save['id']}/jobs", json=body)
            assert response.status_code == 200, response.text
            await asyncio.gather(*runtime.jobs.tasks)
            async with runtime.sessions() as db:
                assert (await db.get(AIJob, response.json()["id"])).status == "completed"
        assert calls == 101
        replay = await c.post(f"/api/saves/{save['id']}/jobs", json=body)
        assert replay.json()["id"] == response.json()["id"] and calls == 101
        async with runtime.sessions() as db:
            assert not await db.scalar(
                select(func.count())
                .select_from(RateBucket)
                .where(RateBucket.key.like("artifact:%"))
            )


async def test_different_users_can_execute_together(app, monkeypatch):
    entered = 0
    both_entered = asyncio.Event()

    async def reply(turn, checkpointer):
        nonlocal entered
        entered += 1
        if entered == 2:
            both_entered.set()
        await asyncio.wait_for(both_entered.wait(), 5)
        yield "听到了。"

    monkeypatch.setattr(app.state.dependencies, "reply", reply)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as first,
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as second,
    ):
        saves = []
        for client in (first, second):
            await client.post("/api/auth/dev", json={})
            save = await create(client)
            await act(client, save, "begin")
            saves.append(save)
        app.state.settings.agent_mode = "deepseek"
        app.state.settings.deepseek_api_key = "fixture"
        await asyncio.gather(
            *(
                act(c, s, "speak", text="你好。")
                for c, s in zip((first, second), saves, strict=True)
            )
        )
        assert entered == 2
