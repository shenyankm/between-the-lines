"""Investigated choices: permissions, consequences and durable player rationale."""

from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from test_gameplay_depth import advance, send, setup

from app.context import AgentTurn
from app.db import Save
from app.domain import RuleError, apply_npc, apply_player, initial_state
from app.game_types import GameState
from app.investigation import npc_evidence, read_model
from app.schemas import TurnInput
from app.services import GameService
from app.story import load_story


@pytest.mark.unit
@pytest.mark.parametrize("first", ["boundary", "public_confront"])
@pytest.mark.parametrize("public", [False, True])
def test_two_investigated_routes_finish_without_relationship_softlock(first, public):
    s = advance(initial_state(), "begin", first, "next", "ask_sun", "ask_li", "audit_purchase")
    if first == "boundary":
        s = advance(s, "confide_sun")
        assert "sun_admission" in s.evidence
    else:
        with pytest.raises(RuleError, match="熟悉度"):
            apply_player(s, "confide_sun")
    if public:
        s = advance(s, "report")
    s = advance(s, "escalate_purchase" if public else "settle_purchase")
    s, _ = apply_npc(s, "li", "request_materials")
    s = advance(s, "supplement")
    # Professional approval must never require reconciling with an antagonist.
    s, _ = apply_npc(s, "li", "approve_purchase")
    if "company_review" in s.flags:
        with pytest.raises(RuleError, match="协调"):
            apply_player(s, "next")
        s = advance(s, "attend_review")
    s = advance(
        s,
        "next",
        "trace_rumor",
        "ask_zhang",
        "publish_rumor" if public else "resolve_rumor",
        "deliver",
    )
    if "company_review" in s.flags and "attend_review" not in s.flags:
        s = advance(s, "attend_review")
    if s.stress >= 80:
        s = advance(s, "take_break")
    s = advance(s, "next")
    assert s.ending == ("公开事实，守住边界" if public else "克制纠偏，保留记录")


@pytest.mark.unit
def test_relationship_not_farmed_and_records_private_until_published():
    s = advance(
        initial_state(),
        "begin",
        "boundary",
        "next",
        "ask_sun",
        "ask_li",
        "audit_purchase",
        "confide_sun",
    )
    assert "requirements" in s.flags
    before = s.model_dump()
    with pytest.raises(RuleError):
        apply_player(s, "ask_sun")
    assert s.model_dump() == before
    assert not npc_evidence(s, "zhang")
    s = advance(s, "escalate_purchase")
    assert len(npc_evidence(s, "zhang")) == 2
    assert not any("改口" in r for r in npc_evidence(s, "zhang"))
    assert apply_player(s, "speak")[0] == s


@pytest.mark.unit
def test_legacy_defaults_and_hidden_records_not_projected():
    old = initial_state().model_dump(exclude={"trust", "evidence", "decisions"})
    s = GameState.model_validate(old)
    assert s.trust.sun == 45 and not s.decisions
    assert read_model(s)["records"] == []
    public = load_story().public().model_dump_json()
    assert "sun_admission" not in public and "persona" not in public
    assert set(load_story().npcs) == {"sun", "li", "zhang"}


@pytest.mark.unit
def test_heat_event_once_rest_and_termination():
    s = advance(initial_state(), "begin", "boundary", "next")
    s.heat, s.stress = 60, 85
    s = advance(s, "ask_li")
    assert s.flags.count("company_review") == 1 and "exhaustion" in s.flags
    s = advance(s, "attend_review", "take_break")
    assert s.stress < 80
    assert s.flags.count("company_review") == 1
    with pytest.raises(RuleError):
        apply_player(s, "take_break")
    assert advance(s, "leave").ending


@pytest.mark.integration
async def test_reason_required_idempotent_and_private_to_target(app):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c,
    ):
        save = await setup(c)
        for action in ["boundary", "next", "ask_sun", "ask_li", "audit_purchase", "confide_sun"]:
            await send(c, save, action)
        before = save["version"]
        response = await c.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": before, "action": "settle_purchase"},
        )
        assert response.status_code == 422
        _result, payload = await send(c, save, "settle_purchase", "先保留证据，避免影响项目")
        replay = await c.post(f"/api/saves/{save['id']}/turns", json=payload)
        assert replay.status_code == 200
        state = save["state"]
        assert len(state["decisions"]) == 1
        assert state["decisions"][0]["reason"] == "先保留证据，避免影响项目"
        assert "sun_admission" in state["decisions"][0]["evidence"]
        assert save["version"] == before + 1
        service: GameService = app.state.runtime.service
        async with service.sessions() as db:
            row = await db.scalar(select(Save).where(Save.id == save["id"]))
            user_id = row.user_id
        ctx = await service.context_for(
            AgentTurn(
                str(uuid4()),
                user_id,
                save["id"],
                TurnInput(request_id=uuid4(), version=save["version"], npc="zhang", text="你好"),
            )
        )
        assert not ctx.evidence
        assert not any("改口" in m or "先保留证据" in m for m in ctx.memories)
