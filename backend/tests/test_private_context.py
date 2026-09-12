import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import mock_llm
from app.main import app

pytestmark = pytest.mark.integration


def test_private_dialogue_does_not_reach_other_npc_or_new_save(monkeypatch):
    original = mock_llm.handle_request
    observed = []

    async def inspect(request):
        payload = json.loads(request.content)
        observed.append(payload)
        return await original(request)

    monkeypatch.setattr(mock_llm, "handle_request", inspect)
    with TestClient(app) as client:
        client.post("/api/auth/dev", json={"name": "隔离测试"})
        for game_index in range(2):
            save = client.post("/api/saves", json={}).json()
            client.post(
                f"/api/saves/{save['id']}/turns",
                json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
            )
            for npc in ("sun", "zhang"):
                save = client.get(f"/api/saves/{save['id']}").json()
                response = client.post(
                    f"/api/saves/{save['id']}/turns",
                    json={
                        "request_id": str(uuid4()),
                        "version": save["version"],
                        "action": "speak",
                        "npc": npc,
                        "text": "私聊暗号PRIVATE_17"
                        if game_index == 0 and npc == "sun"
                        else "你好",
                    },
                )
                assert '"status": "completed"' in response.text
                latest = json.dumps(observed[-1], ensure_ascii=False)
                if game_index == 0 and npc == "sun":
                    assert "PRIVATE_17" in latest
                else:
                    assert "PRIVATE_17" not in latest
