from uuid import uuid4

import httpx
import pytest

from app.db import Event, Save, Turn

pytestmark = pytest.mark.integration


async def test_phone_evidence_uses_full_current_act_history_without_changing_facts(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.post("/api/auth/dev", json={})
        user = (await client.get("/api/auth/me")).json()["id"]
        save = (await client.post("/api/saves", json={"story_version": 3})).json()
        runtime = app.state.runtime
        async with runtime.sessions.begin() as db:
            stored = await db.get(Save, save["id"])
            stored.state = {**stored.state, "act": 3, "node": "act_3"}
            original_state = stored.state.copy()
            expected = {}
            samples = [
                (
                    "report",
                    "向你同步项目事实：交付节点按原计划推进。",
                    "dm",
                    "zhang",
                    3,
                    "player",
                    "completed",
                ),
                (
                    "trace_rumor",
                    "请确认谣言最初从哪里传出的。",
                    "dm",
                    "li",
                    3,
                    "player",
                    "completed",
                ),
                ("", "我没有决定跳槽。", "group", "sun", 3, "player", "failed"),
                ("", "我没有决定跳槽。", "group", "sun", 2, "player", "completed"),
                ("", "我没有决定跳槽。", "group", "sun", 3, "npc", "completed"),
                ("", "我没有决定跳槽。", "scene", "sun", 3, "player", "completed"),
            ]
            for choice, text, channel, npc, act, kind, status in samples:
                turn = Turn(
                    save_id=stored.id,
                    user_id=user,
                    request_id=str(uuid4()),
                    payload={},
                    status=status,
                )
                db.add(turn)
                await db.flush()
                event = Event(
                    save_id=stored.id,
                    turn_id=turn.id,
                    operation="player",
                    audience=[npc],
                    data={
                        "kind": kind,
                        "text": text,
                        "channel": channel,
                        "npc": npc,
                        "act": act,
                        "action": "speak",
                    },
                )
                db.add(event)
                await db.flush()
                if choice:
                    expected[choice] = [event.id]
            # Evidence predates the latest 50-event page.
            for i in range(55):
                db.add(
                    Event(
                        save_id=stored.id,
                        operation=f"filler-{i}",
                        audience=[],
                        data={"kind": "npc", "text": "普通回应", "npc": "sun", "act": 3},
                    )
                )
        response = await client.get(f"/api/saves/{save['id']}/play-state")
        assert response.status_code == 200, response.text
        view = response.json()
        assert view["phone_choice_evidence"] == {"report": expected["report"]}
        assert not set(expected["report"]) & {event["id"] for event in view["events"]}
        assert view["save"]["state"] == original_state
        assert view["save"]["version"] == save["version"]
        again = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
        assert again["phone_choice_evidence"] == {"report": expected["report"]}
        blocked = await client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "trace_rumor",
                "npc": "li",
            },
        )
        assert blocked.status_code == 422
        assert "不能改选" in blocked.text


async def test_successful_phone_choice_locks_alternatives(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.post("/api/auth/dev", json={})
        save = (await client.post("/api/saves", json={"story_version": 3})).json()
        async with app.state.runtime.sessions.begin() as db:
            stored = await db.get(Save, save["id"])
            stored.state = {**stored.state, "act": 3, "node": "act_3"}
        response = await client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "speak",
                "npc": "sun",
                "channel": "group",
                "text": "我没有决定跳槽。",
            },
        )
        assert response.status_code == 200, response.text
        view = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
        assert "rumor_choice:clarify" in view["save"]["state"]["flags"]
        assert "clarified" not in view["save"]["state"]["flags"]
        blocked = await client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": view["save"]["version"],
                "action": "report",
                "npc": "zhang",
            },
        )
        assert blocked.status_code == 422
        assert "不能改选" in blocked.text
