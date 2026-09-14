import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.context import AgentTurn
from app.db import Event
from app.schemas import TurnInput

pytestmark = pytest.mark.integration


async def test_mentions_persist_once_and_remain_private(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.post("/api/auth/dev", json={})
        user = (await client.get("/api/auth/me")).json()["id"]
        save = (await client.post("/api/saves", json={"story_version": 3})).json()

        async def submit(action, params=None, text="", channel="work"):
            nonlocal save
            body = {
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": action,
                "npc": "sun",
                "channel": channel,
                "text": text,
            }
            if params is not None:
                body["params"] = params
            response = await client.post(f"/api/saves/{save['id']}/turns", json=body)
            assert response.status_code == 200, response.text
            data = json.loads(
                next(f for f in response.text.split("\n\n") if f.startswith("event: done")).split(
                    "data: ", 1
                )[1]
            )
            assert data["status"] == "completed", data
            save = data["save"]
            return body, data

        await submit("begin")
        await submit("next")
        await submit("speak", text="仅孙淼知道的私人内容", channel="dm")
        invalid = await client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "supplement",
                "npc": "sun",
                "channel": "work",
                "params": {
                    "evidence": [],
                    "supplement_note": "无效提交不能通知",
                    "mentions": ["li"],
                },
            },
        )
        assert invalid.status_code == 422
        unchanged = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
        assert unchanged["save"]["version"] == save["version"]
        assert not any("无效提交不能通知" in e["text"] for e in unchanged["events"])
        body, result = await submit(
            "supplement",
            {
                "evidence": ["quote", "purpose"],
                "supplement_note": "核对本版材料的专用说明",
                "mentions": ["li", "zhang"],
            },
        )
        retry = await client.post(f"/api/saves/{save['id']}/turns", json=body)
        assert retry.status_code == 200
        recovered = await client.get(f"/api/saves/{save['id']}/turns/{body['request_id']}")
        assert recovered.status_code == 200
        assert (
            recovered.json()["result"]["save"]["state"]["work"]["submissions"]
            == result["save"]["state"]["work"]["submissions"]
        )
        runtime = app.state.runtime
        async with runtime.sessions() as db:
            notices = (
                await db.scalars(select(Event).where(Event.operation == "supplement_notification"))
            ).all()
            assert len(notices) == 1
            assert notices[0].audience == ["li", "zhang"]
            assert notices[0].data["material_version"] == 2
        reread = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
        assert (
            reread["save"]["state"]["work"]["submissions"]
            == result["save"]["state"]["work"]["submissions"]
        )
        for npc in ["sun", "li", "zhang", "wang"]:
            context = await runtime.service.context_for(
                AgentTurn(
                    str(uuid4()),
                    user,
                    save["id"],
                    TurnInput(request_id=uuid4(), version=save["version"], npc=npc),
                )
            )
            content = context.model_dump_json()
            assert ("核对本版材料的专用说明" in content) == (npc in ["li", "zhang"])
            if npc != "sun":
                assert "仅孙淼知道的私人内容" not in content
