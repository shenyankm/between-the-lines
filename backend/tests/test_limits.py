"""Provider failure and execution behavior without accounting limits."""

from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app import mock_llm

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
