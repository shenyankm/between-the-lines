import os
from uuid import uuid4

os.environ["ENVIRONMENT"] = "test"
os.environ["AGENT_MODE"] = "mock"

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        assert c.post("/api/auth/dev", json={"name": "测试玩家"}).status_code == 200
        yield c


def create(c):
    return c.post("/api/saves", json={}).json()


def turn(c, save, action, npc="sun", text="", request_id=None):
    payload = {
        "request_id": request_id or str(uuid4()),
        "version": save["version"],
        "action": action,
        "npc": npc,
        "text": text,
    }
    response = c.post(f"/api/saves/{save['id']}/turns", json=payload)
    if response.status_code == 200:
        fresh = c.get(f"/api/saves/{save['id']}").json()
        save.update(fresh)
    return response, payload


def test_full_story_and_reload(client):
    save = create(client)
    for action, npc, text in [
        ("begin", "sun", ""),
        ("boundary", "sun", ""),
        ("next", "sun", ""),
        ("speak", "sun", "还缺哪些材料？"),
        ("supplement", "sun", ""),
        ("report", "zhang", ""),
        ("speak", "zhang", "请支持这个项目"),
        ("speak", "li", "材料齐全，请审核"),
        ("next", "sun", ""),
        ("clarify", "sun", ""),
        ("deliver", "sun", ""),
        ("next", "sun", ""),
    ]:
        response, _ = turn(client, save, action, npc, text)
        assert response.status_code == 200, response.text
        assert '"status": "completed"' in response.text, response.text
    assert save["state"]["ending"] == "保持职业关系和边界"
    events = client.get(f"/api/saves/{save['id']}/events").json()
    assert any(e["kind"] == "work" for e in events)
    assert any(e["kind"] == "epilogue" and "边界" in e["text"] for e in events)
    assert client.get(f"/api/saves/{save['id']}").json() == save


def test_idempotency_and_version_conflict(client):
    save = create(client)
    _response, payload = turn(client, save, "begin")
    original = save.copy()
    repeated = client.post(f"/api/saves/{save['id']}/turns", json=payload)
    assert repeated.status_code == 200
    assert client.get(f"/api/saves/{save['id']}").json() == original
    payload["action"] = "boundary"
    assert client.post(f"/api/saves/{save['id']}/turns", json=payload).status_code == 409
    payload["request_id"] = str(uuid4())
    assert client.post(f"/api/saves/{save['id']}/turns", json=payload).status_code == 409


def test_identity_isolation_and_logout(client):
    save = create(client)
    client.post("/api/auth/logout", json={})
    assert client.get("/api/auth/me").status_code == 401
    client.post("/api/auth/dev", json={"name": "测试玩家"})
    assert client.get(f"/api/saves/{save['id']}").status_code == 404
    assert client.get(f"/api/saves/{save['id']}/events").status_code == 404
    assert turn(client, save, "begin")[0].status_code == 404


def test_csrf_and_no_persona_leak(client):
    assert (
        client.post(
            "/api/saves", json={}, headers={"Origin": "https://attacker.example"}
        ).status_code
        == 403
    )
    assert client.post("/api/saves", content="{}").status_code == 415
    assert "persona" not in client.get("/api/story").text


def test_failure_keeps_committed_action(app, client, monkeypatch):

    async def failing(turn, checkpointer, usage):
        npc_operation = app.state.runtime.service.npc_operation

        await npc_operation(turn.id, "sun", "request_materials")
        raise RuntimeError("simulated provider failure")
        yield "unreachable"

    save = create(client)
    for action in ("begin", "boundary", "next"):
        turn(client, save, action)
    monkeypatch.setattr(app.state.dependencies, "reply", failing)
    response, payload = turn(client, save, "speak", text="请说明缺少材料")
    assert '"status": "failed"' in response.text
    assert "requirements" in save["state"]["flags"]
    assert not any(e["kind"] == "npc" for e in client.get(f"/api/saves/{save['id']}/events").json())
    version = save["version"]
    client.post(f"/api/saves/{save['id']}/turns", json=payload)
    assert client.get(f"/api/saves/{save['id']}").json()["version"] == version
