"""Authoritative choices, delayed outcomes and persistent role-scoped memories."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.context import AgentTurn
from app.db import Event, Save, Turn
from app.domain import RuleError, apply_npc, apply_player, initial_state
from app.game_types import GameState
from app.schemas import TurnInput
from app.services import GameService


def advance(state, *actions):
    for action in actions:
        state, _ = apply_player(state, action)
    return state


@pytest.mark.unit
@pytest.mark.parametrize("resolution", ["repair", "written_record"])
@pytest.mark.parametrize("rumor", ["clarify", "document_rumor"])
@pytest.mark.parametrize("support", [True, False])
def test_branches_change_access_schedule_and_ending(resolution, rumor, support):
    state = advance(initial_state(), "begin", "public_confront", "next")
    assert state.consequences and "书面" in state.consequences[-1]
    state, _ = apply_npc(state, "li", "request_materials")
    state = advance(state, "supplement")
    assert apply_npc(state, "li", "approve_purchase")[0].procurement == "approved"
    state = advance(state, resolution)
    with pytest.raises(RuleError):
        apply_player(state, "repair" if resolution == "written_record" else "written_record")
    state, _ = apply_npc(state, "li", "approve_purchase")
    if support:
        state = advance(state, "report")
        state, _ = apply_npc(state, "zhang", "support_project")
    state = advance(state, "next", rumor)
    with pytest.raises(RuleError):
        apply_player(state, "clarify" if rumor == "document_rumor" else "document_rumor")
    state, delivery = apply_player(state, "deliver")
    assert ("调整后" in delivery) is not support
    assert ("schedule_protected" in state.flags) is support
    state = advance(state, "next")
    assert state.ending == (
        "克制留痕，关系待定"
        if rumor == "document_rumor"
        else "修复沟通，保留边界"
        if resolution == "repair"
        else "撕破脸"
    )


@pytest.mark.unit
def test_old_save_is_compatible_and_finished_saves_remain_finished():
    old = initial_state().model_dump(exclude={"consequences"})
    state = GameState.model_validate(old)
    assert state.consequences == []
    state = advance(state, "begin", "leave")
    with pytest.raises(RuleError):
        apply_player(state, "repair")


async def setup(c):
    await c.post("/api/auth/dev", json={"name": "四项回归"})
    save = (await c.post("/api/saves", json={})).json()
    await send(c, save, "begin")
    return save


async def send(c, save, action="speak", text="", npc="sun", request_id=None):
    payload = {
        "request_id": request_id or str(uuid4()),
        "version": save["version"],
        "action": action,
        "npc": npc,
        "text": text,
    }
    r = await c.post(f"/api/saves/{save['id']}/turns", json=payload)
    assert r.status_code == 200, r.text
    result = next(
        json.loads(b.split("data: ", 1)[1])
        for b in r.text.split("\n\n")
        if b.startswith("event: done")
    )
    save.update(result["save"])
    return result, payload


@pytest.mark.integration
async def test_proposal_is_non_mutating_confirmable_and_idempotent(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await setup(c)
        before = dict(save["state"])
        result, _ = await send(c, save, text="以后不要替我定义情绪，我要把这个边界说清楚。")
        assert result["status"] == "completed"
        assert save["state"] == before
        view = (await c.get(f"/api/saves/{save['id']}/play-state")).json()
        assert [e["action"] for e in view["events"] if e["kind"] == "suggestion"] == ["boundary"]
        result, payload = await send(c, save, "boundary", npc="li")
        assert result["status"] == "completed" and result["text"]
        assert "boundary" in save["state"]["flags"]
        version = save["version"]
        replay = await c.post(f"/api/saves/{save['id']}/turns", json=payload)
        assert replay.status_code == 200
        view = (await c.get(f"/api/saves/{save['id']}/play-state")).json()
        assert view["save"]["version"] == version
        # Correct actor even if client submits the currently selected unrelated NPC.
        assert view["events"][-1]["npc"] == "sun"
        assert view["events"][-1]["kind"] == "npc"


@pytest.mark.integration
async def test_memory_survives_context_window_and_service_restart_without_leaks(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await setup(c)
        service = app.state.runtime.service
        async with app.state.runtime.sessions() as db:
            row = await db.get(Save, save["id"])
            user_id = row.user_id
        body = TurnInput(
            request_id=uuid4(),
            version=save["version"],
            text="请记住：我不希望同事叫我菱菱，叫我周凌就好。",
        )
        accepted = await service.begin_turn(save["id"], user_id, body)
        turn = AgentTurn(accepted.id, user_id, save["id"], body)
        await asyncio.gather(
            service.remember_player(turn, body.text), service.propose_action(turn, "boundary")
        )
        await service.remember_player(turn, body.text)  # deduplicated within turn
        with pytest.raises(RuleError, match="原话"):
            await service.remember_player(turn, "玩家答应明天辞职")
        with pytest.raises(RuleError):
            await service.propose_action(turn, "deliver")  # stage gate
        with pytest.raises(RuleError):
            await service.propose_action(turn, "leave")  # no destructive suggestion
        await service.finish_turn(turn.id, "好，以后叫你周凌。", {})
        with pytest.raises(RuleError, match="回合已结束"):
            await service.remember_player(turn, body.text)
        # Populate >30 genuinely persisted events without 40 redundant LLM calls.
        async with app.state.runtime.sessions.begin() as db:
            for i in range(40):
                t = Turn(
                    save_id=save["id"],
                    user_id=user_id,
                    request_id=str(uuid4()),
                    payload={},
                    status="completed",
                )
                db.add(t)
                await db.flush()
                db.add(
                    Event(
                        save_id=save["id"],
                        turn_id=t.id,
                        operation="player",
                        audience=["sun"],
                        data={
                            "kind": "player",
                            "text": f"普通闲聊{i}",
                            "npc": "sun",
                            "act": 1,
                            "action": "speak",
                        },
                    )
                )
        fresh_service = GameService(app.state.runtime.sessions, app.state.settings)
        context = await fresh_service.context_for(turn)
        assert not any(body.text == e.text for e in context.history)
        assert sum(body.text in m for m in context.memories) == 1
        for npc in ["li", "zhang"]:
            other = AgentTurn(turn.id, user_id, save["id"], body.model_copy(update={"npc": npc}))
            assert body.text not in (await fresh_service.context_for(other)).model_dump_json()
        other_save = (await c.post("/api/saves", json={})).json()
        other = AgentTurn(turn.id, user_id, other_save["id"], body)
        assert body.text not in (await fresh_service.context_for(other)).model_dump_json()


@pytest.mark.integration
async def test_action_reaction_is_immediate_even_when_model_is_unavailable(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await setup(c)

        async def fail(turn, checkpointer, usage):
            raise RuntimeError("provider unavailable")
            yield ""

        app.state.dependencies.reply = fail
        result, payload = await send(c, save, "public_confront")
        assert result["status"] == "completed"
        assert "当着大家" in result["text"]
        assert "confronted" in save["state"]["flags"]
        await c.post(f"/api/saves/{save['id']}/turns", json=payload)
        async with app.state.runtime.sessions() as db:
            rows = (
                await db.scalars(
                    select(Event).where(Event.save_id == save["id"], Event.operation == "player")
                )
            ).all()
            assert len(rows) == 2
