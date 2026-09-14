"""Regression tests for lifecycle, persistence and the additive read model."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.db import Event, Save, Turn
from app.domain import apply_npc, apply_player, initial_state
from app.factory import create_app
from app.story import load_story

pytestmark = pytest.mark.integration


async def player(client):
    await client.post("/api/auth/dev", json={"name": "runtime"})
    return (await client.post("/api/saves", json={})).json()


def payload(save, action="begin"):
    return {"request_id": str(uuid4()), "version": save["version"], "action": action}


async def test_replay_bypasses_capacity_and_preserves_usage(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await player(c)
        body = payload(save)
        await c.post(f"/api/saves/{save['id']}/turns", json=body)
        app.state.settings.max_concurrent_turns = 0
        replay = await c.post(f"/api/saves/{save['id']}/turns", json=body)
        assert replay.status_code == 200
        assert len(app.state.runtime.runner.active) == 0
        view = (await c.get(f"/api/saves/{save['id']}/play-state")).json()
        assert view["save"]["version"] == 1
        assert len(view["events"]) == 1
        assert view["active_turn"] is None
        assert app.state.runtime.metrics._duration_count == 1


async def test_subscriber_cancellation_does_not_cancel_runner_and_shutdown_drains(app):
    entered, release = asyncio.Event(), asyncio.Event()

    async def delayed(turn, checkpointer, usage):
        entered.set()
        await release.wait()
        usage["model_calls"] = 1
        yield "持久化的完整对白。"

    app.state.dependencies.reply = delayed
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await player(c)
        await c.post(f"/api/saves/{save['id']}/turns", json=payload(save))
        save = (await c.get(f"/api/saves/{save['id']}")).json()
        body = {**payload(save, "speak"), "text": "你好"}
        sending = asyncio.create_task(c.post(f"/api/saves/{save['id']}/turns", json=body))
        await asyncio.wait_for(entered.wait(), 3)
        view = (await c.get(f"/api/saves/{save['id']}/play-state")).json()
        assert view["active_turn"]["request_id"] == body["request_id"]
        sending.cancel()
        await asyncio.gather(sending, return_exceptions=True)
        assert len(app.state.runtime.runner.tasks) == 1
        closing = asyncio.create_task(app.state.runtime.runner.close())
        await asyncio.sleep(0)
        assert not closing.done()
        release.set()
        await asyncio.wait_for(closing, 3)
        result = (await c.get(f"/api/saves/{save['id']}/turns/{body['request_id']}")).json()
        assert result["status"] == "completed"
        assert result["result"]["text"] == "持久化的完整对白。"
        original = result["result"]
        repeated = await app.state.runtime.service.finish_turn(result["id"], "wrong", {}, True)
        assert repeated == original
        assert not app.state.runtime.runner.active


async def test_second_instance_cannot_recover_a_live_instances_turns(app):
    async with app.router.lifespan_context(app):
        second = create_app(app.state.settings.model_copy())
        with pytest.raises(RuntimeError, match="Another API instance"):
            async with second.router.lifespan_context(second):
                pytest.fail("Second instance acquired the lease")


async def test_future_save_format_is_rejected_before_mutation(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await player(c)
        async with app.state.runtime.sessions.begin() as db:
            row = await db.get(Save, save["id"])
            row.state_schema_version = 2
        response = await c.post(f"/api/saves/{save['id']}/turns", json=payload(save))
        assert response.status_code == 409
        async with app.state.runtime.sessions() as db:
            assert not (await db.scalars(select(Turn).where(Turn.save_id == save["id"]))).all()
            assert not (await db.scalars(select(Event).where(Event.save_id == save["id"]))).all()


@pytest.mark.unit
@pytest.mark.parametrize(
    "choice,ending,credit,stress,heat",
    [
        ("boundary", "找回自我 · 只留工作往来", 90, 0, 0),
        ("contact_wang", "找回自我 · 只留工作往来", 90, 0, 0),
        ("public_confront", "找回自我 · 只留工作往来", 80, 15, 25),
    ],
)
def test_early_choices_keep_costs_but_do_not_override_final_choice(
    choice, ending, credit, stress, heat
):
    state = initial_state()
    for action in ("begin", choice, "next"):
        state, _ = apply_player(state, action)
    state, _ = apply_npc(state, "sun", "request_materials")
    for action in ("supplement", "report"):
        state, _ = apply_player(state, action)
    state, _ = apply_npc(state, "li", "approve_purchase")
    for action in ("next", "clarify", "deliver", "cut_ties", "next"):
        state, _ = apply_player(state, action)
    assert (state.ending, state.credit, state.stress, state.heat) == (ending, credit, stress, heat)


@pytest.mark.unit
def test_public_story_has_all_assets_and_no_private_personas():
    from pathlib import Path

    story = load_story()
    assert "persona" not in story.public().model_dump_json()
    root = Path(__file__).resolve().parents[2] / "frontend/public"
    # Container API images deliberately have no frontend; the host/CI unit pass validates files.
    if root.exists():
        assert all((root / asset.lstrip("/")).is_file() for asset in story.assets())
    assert len(story.acts) == 5


async def test_structured_failure_preserves_facts_and_original_identity(app):
    async def timeout(turn, checkpointer, usage):
        raise TimeoutError("private provider details")
        yield  # pragma: no cover

    app.state.dependencies.reply = timeout
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await player(c)
        await c.post(f"/api/saves/{save['id']}/turns", json=payload(save))
        save = (await c.get(f"/api/saves/{save['id']}")).json()
        body = {**payload(save, "speak"), "text": "保存这次行动"}
        response = await c.post(
            f"/api/saves/{save['id']}/turns", json=body, headers={"X-Request-Id": "trace-failure"}
        )
        assert "private provider details" not in response.text
        assert "event: done" in response.text
        result = (await c.get(f"/api/saves/{save['id']}/turns/{body['request_id']}")).json()[
            "result"
        ]
        assert result["failure"]["code"] == "turn_timeout"
        assert result["failure"]["request_id"] == "trace-failure"
        assert result["save"]["version"] > save["version"]
        replay = await c.post(f"/api/saves/{save['id']}/turns", json=body)
        assert '"turn_timeout"' in replay.text
        async with app.state.runtime.sessions() as db:
            turn = await db.get(Turn, result["turn_id"])
            assert turn.payload["request_id"] == body["request_id"]
            events = (await db.scalars(select(Event).where(Event.turn_id == turn.id))).all()
            assert len(events) == 1 and events[0].operation == "player"


async def test_persistence_failure_is_subscription_error_until_recovery(app, monkeypatch):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await player(c)
        body = payload(save)
        service = app.state.runtime.service
        original = service.finish_turn

        async def unavailable(*args, **kwargs):
            raise RuntimeError("private database details")

        monkeypatch.setattr(service, "finish_turn", unavailable)
        response = await c.post(f"/api/saves/{save['id']}/turns", json=body)
        assert "event: error" in response.text
        assert (
            "event: done" not in response.text and "private database details" not in response.text
        )
        lookup = (await c.get(f"/api/saves/{save['id']}/turns/{body['request_id']}")).json()
        assert lookup["status"] == "running" and lookup["result"] is None
        monkeypatch.setattr(service, "finish_turn", original)
        await service.recover_stale_turns(all_running=True)
        lookup = (await c.get(f"/api/saves/{save['id']}/turns/{body['request_id']}")).json()
        assert lookup["result"]["failure"]["code"] == "turn_interrupted"
        assert not app.state.runtime.runner.active


async def test_reply_records_the_current_scene_and_full_trial_preserves_guest_identity(app):
    app.state.settings.guest_full_story_enabled = True
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        user = (await c.post("/api/auth/guest", json={})).json()
        save = (await c.post("/api/saves", json={})).json()
        for action, text in [("begin", ""), ("speak", "你好"), ("next", "")]:
            r = await c.post(
                f"/api/saves/{save['id']}/turns", json={**payload(save, action), "text": text}
            )
            assert r.status_code == 200
            view = (await c.get(f"/api/saves/{save['id']}/play-state")).json()
            save = view["save"]
            if action == "speak":
                reply = next(e for e in view["events"] if e["kind"] == "npc")
                assert reply["scene"] == save["state"]["node"] == "act_1"
        assert save["state"]["act"] == 2
        assert (await c.get("/api/auth/me")).json()["id"] == user["id"]
        assert (await c.get("/api/auth/me")).json()["identity_type"] == "guest"
