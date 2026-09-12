from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app import mock_llm
from app.config import get_settings
from app.main import app


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
        ("max_tool_calls", 0, False),
    ],
)
def test_agent_budgets_stop_execution(monkeypatch, setting, value, tool_committed):
    monkeypatch.setattr(get_settings(), setting, value)
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


def test_provider_rate_limit_has_no_unbounded_retry(monkeypatch):
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
        assert not any(e["kind"] in {"npc", "work"} for e in events)
