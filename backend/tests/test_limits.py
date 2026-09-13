"""Every ceiling on what a turn may consume, and proof each one actually stops it.

Two kinds. The agent's per-turn budgets bound a single request's work; the monthly
cost cap bounds aggregate spend. Both fail closed, and both are only worth having if
a test shows the request stopping rather than the limit being merely configured.
"""

import asyncio
import json
import os
from datetime import timedelta
from uuid import uuid4

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app import mock_llm
from app.config import Settings, get_settings
from app.db import utcnow
from app.services import month_to_date_cost
from app.storage import Database

pytestmark = pytest.mark.integration


def prepare(client):
    client.post("/api/auth/dev", json={"name": "预算验证"})
    save = client.post("/api/saves", json={}).json()
    for action in ("begin", "boundary", "next"):
        client.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": save["version"], "action": action},
        )
        save = client.get(f"/api/saves/{save['id']}").json()
    return save


@pytest.mark.parametrize(
    "setting,value,tool_committed",
    [
        ("max_model_calls", 1, True),
        ("max_tool_calls", 0, True),
    ],
)
def test_agent_budgets_stop_execution(app, monkeypatch, setting, value, tool_committed):
    monkeypatch.setattr(app.state.settings, setting, value)
    with TestClient(app) as client:
        save = prepare(client)
        response = client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "speak",
                "npc": "sun",
                "text": "请明确材料要求",
            },
        )
        assert '"status": "failed"' in response.text
        state = client.get(f"/api/saves/{save['id']}").json()["state"]
        assert ("requirements" in state["flags"]) is tool_committed
        assert "execution_budget_exhausted" in response.text
        # Deterministic intent survives, but the bounded model produces no reply.
        events = client.get(f"/api/saves/{save['id']}/events").json()
        assert not any(e["kind"] == "npc" for e in events)


def test_provider_rate_limit_has_no_unbounded_retry(app, monkeypatch):
    count = 0

    async def limited(request):
        nonlocal count
        count += 1
        return httpx.Response(
            429, json={"error": {"message": "fixture rate limit", "type": "rate_limit_error"}}
        )

    monkeypatch.setattr(mock_llm, "handle_request", limited)
    with TestClient(app) as client:
        save = prepare(client)
        response = client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "speak",
                "npc": "sun",
                "text": "请明确材料要求",
            },
        )
        assert '"status": "failed"' in response.text
        assert count == 1
        events = client.get(f"/api/saves/{save['id']}/events").json()
        # A clear request is committed before prose; failed prose cannot undo it.
        state = client.get(f"/api/saves/{save['id']}").json()["state"]
        assert "requirements" in state["flags"]
        assert not any(e["kind"] == "npc" for e in events)


def cap(monkeypatch, app, usd: float, mode: str = "deepseek") -> None:
    """Point only `services` at a configuration with a cost ceiling.

    main.py and agents.py keep reading the real settings, which conftest pins to mock
    mode. That matters twice: main.py's own `model_unconfigured` guard would fire
    first on a deepseek-mode request holding no key, and agents.py would otherwise
    build a client that reaches the real API. Because begin_turn raises at the cap
    before it constructs any model call, the mode set here is a gate-setting and
    never a live call.
    """
    monkeypatch.setattr(
        app.state.runtime.service,
        "settings",
        Settings(
            _env_file=None, agent_mode=mode, deepseek_api_key="fixture", monthly_cost_cap_usd=usd
        ),
    )


def seed_billing(client, rows: list[tuple[int, float | None]]) -> str:
    """Insert billing rows under a real player and return the save they belong to.

    `rows` pairs an age in days with a cost, or None for a turn predating the
    `usage` field. Seeded through SQL rather than by playing turns because mock mode
    records a cost of exactly 0.0 -- the aggregation cannot be observed any other
    way. The None rows are the interesting ones: `usage` is NOT NULL, so an old turn
    holds `{}`, and it is the missing JSON key that has to contribute nothing to the
    sum rather than poisoning it.
    """
    user = client.get("/api/auth/me").json()["id"]
    save = client.post("/api/saves", json={}).json()["id"]
    with psycopg.connect(os.environ["CHECKPOINT_URL"]) as conn, conn.cursor() as cur:
        for age_days, cost in rows:
            created = utcnow() - timedelta(days=age_days)
            usage = "{}" if cost is None else json.dumps({"cost_estimate_usd": cost})
            # `attempt` is spelled out because its default of 1 lives on the model,
            # not on the column: a raw insert that omits it is a NOT NULL violation
            # rather than a default.
            cur.execute(
                "INSERT INTO turns (id, save_id, user_id, request_id, payload, status,"
                " attempt, usage, created_at, updated_at)"
                " VALUES (%s,%s,%s,%s,'{}'::jsonb,'completed',1,%s::jsonb,%s,%s)",
                (str(uuid4()), save, user, str(uuid4()), usage, created, created),
            )
    return save


def begin(client, save_id: str):
    # `begin` on a fresh save, so no turn is needed to reach a playable state: the
    # cap fires before the rule check, and a test about billing should not also
    # depend on the game's opening sequence.
    return client.post(
        f"/api/saves/{save_id}/turns",
        json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
    )


def month_to_date() -> float:
    async def read() -> float:
        database = Database(get_settings())
        Session = database.sessions
        try:
            async with Session() as db:
                return await month_to_date_cost(db)
        finally:
            # asyncio.run closes its loop, and the shared engine would otherwise keep
            # the connection it opened there -- the next test to draw that pool entry
            # fails inside asyncpg, far from the cause. Disposing within the same loop
            # is the only point at which it is safe.
            await database.close()

    return asyncio.run(read())


def test_month_to_date_cost_counts_only_this_month_and_skips_turns_without_usage(app):
    with TestClient(app) as client:
        client.post("/api/auth/dev", json={"name": "账单"})
        # 5.0 now, an old turn with no cost recorded, and 100.0 last month.
        seed_billing(client, [(0, 5.0), (0, None), (40, 100.0)])
    assert month_to_date() == pytest.approx(5.0)


def test_an_exceeded_cost_cap_refuses_the_turn(app, monkeypatch):
    with TestClient(app) as client:
        client.post("/api/auth/dev", json={"name": "账单"})
        save = seed_billing(client, [(0, 5.0)])
        cap(monkeypatch, app, 0.01)
        assert begin(client, save).status_code == 200
        response = client.post(
            f"/api/saves/{save}/turns",
            json={"request_id": str(uuid4()), "version": 1, "action": "speak", "text": "你好"},
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "monthly_cost_cap_reached"
    # Numeric, and bounded by the longest month a client could be told to wait: it
    # is a Retry-After, so a caller sleeps on this value rather than guessing.
    assert response.json()["error"]["code"] == "monthly_cost_cap_reached"


def test_spend_from_a_previous_month_does_not_count_against_the_cap(app, monkeypatch):
    with TestClient(app) as client:
        client.post("/api/auth/dev", json={"name": "账单"})
        # 105.0 all told, but only 5.0 of it inside the window. A cap of 50.0 must
        # not fire; if the window were unbounded this turn would be refused.
        save = seed_billing(client, [(0, 5.0), (40, 100.0)])
        cap(monkeypatch, app, 50.0)
        response = begin(client, save)
    assert response.status_code == 200, response.text


def test_mock_mode_is_exempt_from_the_cap(app, monkeypatch):
    # Every turn costs nothing in mock mode, so a ceiling there could only block CI
    # -- and CI is exactly where the exemption has to hold, because conftest pins
    # mock mode globally and can never spend money to find out.
    with TestClient(app) as client:
        client.post("/api/auth/dev", json={"name": "账单"})
        save = seed_billing(client, [(0, 5.0)])
        cap(monkeypatch, app, 0.000001, mode="mock")
        response = begin(client, save)
    assert response.status_code == 200, response.text
