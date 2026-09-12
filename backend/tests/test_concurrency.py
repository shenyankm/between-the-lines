import asyncio
from uuid import uuid4

import httpx
import pytest

from app.main import app

pytestmark = pytest.mark.integration


async def test_same_save_admission_and_quota(monkeypatch):
    import app.main as main
    import app.services as services

    entered, release = asyncio.Event(), asyncio.Event()

    async def slow_agent(turn, checkpointer, usage):
        entered.set()
        await release.wait()
        yield "我听到了。"

    monkeypatch.setattr(main, "run_agent", slow_agent)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        await c.post("/api/auth/dev", json={"name": "并发验证"})
        save = (await c.post("/api/saves", json={})).json()
        await c.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
        )
        body = {"request_id": str(uuid4()), "version": 1, "action": "speak", "text": "你好"}
        first = asyncio.create_task(c.post(f"/api/saves/{save['id']}/turns", json=body))
        await asyncio.wait_for(entered.wait(), 5)
        second = await c.post(
            f"/api/saves/{save['id']}/turns", json={**body, "request_id": str(uuid4())}
        )
        assert second.status_code == 409
        release.set()
        assert (await first).status_code == 200
        fresh = (await c.get(f"/api/saves/{save['id']}")).json()
        assert fresh["version"] == 2
        monkeypatch.setattr(services.settings, "daily_turn_limit", 2)
        blocked = await c.post(
            f"/api/saves/{save['id']}/turns",
            json={**body, "request_id": str(uuid4()), "version": 2},
        )
        assert blocked.status_code == 429


async def test_timeout_and_capacity_release(monkeypatch):
    import app.main as main

    async def never_finishes(turn, checkpointer, usage):
        await asyncio.sleep(5)
        yield "never"

    monkeypatch.setattr(main, "run_agent", never_finishes)
    monkeypatch.setattr(main.settings, "turn_timeout_seconds", 0.03)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        await c.post("/api/auth/dev", json={"name": "超时验证"})
        save = (await c.post("/api/saves", json={})).json()
        await c.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
        )
        response = await c.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": 1, "action": "speak", "text": "你好"},
        )
        assert '"status": "failed"' in response.text
        assert len(app.state.active) == 0
        events = (await c.get(f"/api/saves/{save['id']}/events")).json()
        assert not any(e["kind"] == "npc" for e in events)


async def test_exhausted_admission_budget_rejects_without_reserving(monkeypatch):
    """The 429 branch is a real capacity limit, not a decoration.

    Driving the budget to zero reaches it without staging 30 genuinely
    concurrent turns, so the assertion is deterministic rather than a race.
    The load test measures throughput against a raised budget and would never
    fail on this branch regressing; this test is what holds it in place.
    """
    import app.main as main

    monkeypatch.setattr(main.settings, "max_concurrent_turns", 0)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        await c.post("/api/auth/dev", json={"name": "预算验证"})
        save = (await c.post("/api/saves", json={})).json()
        blocked = await c.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": save["version"], "action": "begin"},
        )
        assert blocked.status_code == 429
        # A rejected request must not consume the budget it was refused for.
        assert len(app.state.active) == 0
