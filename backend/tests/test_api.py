import json
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


def turn(c, save, action, npc="sun", text="", request_id=None, **extra):
    payload = {
        "request_id": request_id or str(uuid4()),
        "version": save["version"],
        "action": action,
        "npc": npc,
        "text": text,
        **extra,
    }
    response = c.post(f"/api/saves/{save['id']}/turns", json=payload)
    if response.status_code == 200:
        fresh = c.get(f"/api/saves/{save['id']}").json()
        save.update(fresh)
    return response, payload


def confirmed(client, save, action):
    response, _ = turn(client, save, "propose", proposed_action=action)
    assert response.status_code == 200, response.text
    frame = next(f for f in response.text.split("\n\n") if f.startswith("event: done"))
    result = json.loads(frame.split("data: ", 1)[1])
    return turn(client, save, action, proposal_id=result["proposal"]["id"])


def test_full_story_and_reload(client):
    save = create(client)
    for action, npc, text in [
        ("begin", "sun", ""),
        ("boundary", "sun", ""),
        ("next", "sun", ""),
        ("speak", "sun", "还缺哪些材料？"),
        ("dispute_return", "li", ""),
        ("report", "zhang", ""),
        ("speak", "zhang", "请支持这个项目"),
        ("speak", "li", "材料齐全，请审核"),
        ("next", "sun", ""),
        ("clarify", "sun", ""),
        ("review_clarification", "sun", ""),
        ("deliver", "zhang", ""),
    ]:
        response, _ = turn(client, save, action, npc, text)
        assert response.status_code == 200, response.text
        assert '"status": "completed"' in response.text, response.text
    assert confirmed(client, save, "cut_ties")[0].status_code == 200
    assert turn(client, save, "project_review", "zhang")[0].status_code == 200
    assert (
        turn(client, save, "follow_up", params={"boundary_response": "decline"})[0].status_code
        == 200
    )
    assert confirmed(client, save, "close_story")[0].status_code == 200
    assert save["state"]["outcome"]["id"] == "professional_boundary"
    events = client.get(f"/api/saves/{save['id']}/events").json()
    assert any(e["kind"] == "work" for e in events)
    assert not any(e["kind"] == "epilogue" for e in events)
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


def test_relationship_choice_idempotency_and_private_audiences(client, monkeypatch):
    from app import mock_llm

    observed = []
    original = mock_llm.handle_request

    async def inspect(request):
        observed.append(json.loads(request.content))
        return await original(request)

    monkeypatch.setattr(mock_llm, "handle_request", inspect)
    save = create(client)
    turn(client, save, "begin")
    response, wang_payload = turn(client, save, "contact_wang", "wang")
    assert response.status_code == 200
    events = client.get(f"/api/saves/{save['id']}/events").json()
    assert client.post(f"/api/saves/{save['id']}/turns", json=wang_payload).status_code == 200
    assert client.get(f"/api/saves/{save['id']}/events").json() == events
    secret = "这句话只对王会计说：蓝色便签放在抽屉里。"
    assert (
        turn(client, save, "speak", "wang", secret, channel="dm", target="wang")[0].status_code
        == 200
    )
    for _ in range(2):
        assert turn(client, save, "next")[0].status_code == 200
    assert turn(client, save, "keep_distance", "li")[0].status_code == 409
    response, selection = confirmed(client, save, "keep_distance")
    assert response.status_code == 200
    version = save["version"]
    assert client.post(f"/api/saves/{save['id']}/turns", json=selection).status_code == 200
    assert client.get(f"/api/saves/{save['id']}").json()["version"] == version
    for npc in ("sun", "li", "zhang"):
        assert turn(client, save, "speak", npc, "你好")[0].status_code == 200
        request_text = json.dumps(observed[-1], ensure_ascii=False)
        assert secret not in request_text
        assert "谢川" not in request_text
        assert "妈妈" not in request_text
        assert ("sun_observe" in request_text) == (npc == "sun")
    assert confirmed(client, save, "close_story")[0].status_code == 200
    assert save["state"]["outcome"]["id"] == "unresolved"
    refreshed = client.get(f"/api/saves/{save['id']}/play-state").json()["save"]
    assert refreshed["relationships"] == save["relationships"]
    assert {r["id"] for r in refreshed["relationships"]} == {"sun", "li", "zhang", "wang"}
