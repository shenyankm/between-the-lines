"""Product acceptance through the real ASGI adapters, DB and mock agent harness."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app.auth import digest
from app.content import content_hash
from app.context import AgentTurn
from app.db import (
    AIJob,
    OAuthBinding,
    Proposal,
    Save,
    Turn,
    ZhihuContent,
    utcnow,
)
from app.product import process_bindings
from app.schemas import TurnInput

pytestmark = pytest.mark.integration


@pytest.fixture
async def v2(app):
    app.state.settings.story_v2_enabled = True
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.post("/api/auth/dev", json={})
        yield client, app.state.runtime


async def create(client):
    response = await client.post("/api/saves", json={})
    assert response.status_code == 200, response.text
    return response.json()


async def act(client, save, action, npc="sun", text="", **extra):
    body = {
        "request_id": str(uuid4()),
        "version": save["version"],
        "action": action,
        "npc": npc,
        "text": text,
        **extra,
    }
    response = await client.post(f"/api/saves/{save['id']}/turns", json=body)
    assert response.status_code == 200, response.text
    frame = next(f for f in response.text.split("\n\n") if f.startswith("event: done"))
    result = json.loads(frame.split("data: ", 1)[1])
    save.update(result["save"])
    assert result["status"] == "completed", result
    return result, body


async def confirm(client, save, action, npc="sun"):
    proposal, _ = await act(client, save, "propose", npc, proposed_action=action)
    assert proposal["proposal"]["action"] == action
    return await act(client, save, action, npc, proposal_id=proposal["proposal"]["id"])


async def second_act(client, save):
    await act(client, save, "begin")
    await act(client, save, "boundary")
    await act(client, save, "next")


@pytest.mark.parametrize("response", ["decline", "agree"])
@pytest.mark.parametrize("relationship", ["cut_ties", "repair_friendship"])
@pytest.mark.parametrize("model_ready", [True, False])
async def test_three_acts_without_ai_calls(v2, response, relationship, model_ready, monkeypatch):
    client, runtime = v2
    runtime.settings.agent_mode = "mock" if model_ready else "deepseek"
    runtime.settings.deepseek_api_key = ""

    async def unexpected(*args):
        raise AssertionError("Deterministic actions must not invoke a model")
        yield "unreachable"

    monkeypatch.setattr(runtime.runner, "reply", unexpected)
    save = await create(client)
    assert save["story_version"] == 3
    await second_act(client, save)
    # Mainline progress no longer depends on a private-life choice.
    await act(client, save, "dispute_return", "li")
    await act(client, save, "approve_purchase", "li")
    await act(client, save, "next")
    await act(client, save, "clarify")
    await act(client, save, "review_clarification")
    await act(client, save, "deliver", "zhang")
    await confirm(client, save, relationship)
    if relationship == "repair_friendship":
        await act(client, save, "acknowledge_harm")
        await act(client, save, "complete_remedy")
    await act(client, save, "project_review", "zhang")
    await act(client, save, "follow_up", params={"boundary_response": response})
    await confirm(client, save, "close_story")
    assert save["state"]["outcome"]["id"] == (
        "professional_boundary" if relationship == "cut_ties" else "limited_repair"
    )
    view = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
    assert view["ai"]["available"] is model_ready
    assert not any(e["kind"] == "epilogue" for e in view["events"])
    assert any(e.get("speaker") == "system" for e in view["events"])


async def test_proposal_survives_refresh_replay_and_expires(v2):
    client, _runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    result, body = await act(client, save, "propose", proposed_action="public_confront")
    proposal = result["proposal"]
    view = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
    assert view["proposal"] == proposal
    assert "confronted" not in view["save"]["state"]["flags"]
    assert (await client.post(f"/api/saves/{save['id']}/turns", json=body)).status_code == 200
    await act(client, save, "contact_wang", "wang")
    stale = await client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "public_confront",
            "proposal_id": proposal["id"],
        },
    )
    assert stale.status_code == 409
    await confirm(client, save, "public_confront")
    await act(client, save, "verify_notice", "li")
    await act(client, save, "draft_exit", params={"kind": "resign", "reason": "希望更换工作环境"})
    await confirm(client, save, "leave")
    assert "谣言" not in save["ending_summary"]
    assert "已正式提交离职申请" in save["ending_summary"]
    assert "谢川" not in save["ending_summary"]


async def test_proposal_race_has_exactly_one_winner(v2):
    client, _ = v2
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "draft_exit", params={"kind": "resign", "reason": "希望更换工作环境"})
    proposal, _ = await act(client, save, "propose", proposed_action="leave")
    payload = {
        "version": save["version"],
        "action": "leave",
        "proposal_id": proposal["proposal"]["id"],
    }
    replies = await asyncio.gather(
        *(
            client.post(
                f"/api/saves/{save['id']}/turns", json={**payload, "request_id": str(uuid4())}
            )
            for _ in range(2)
        )
    )
    assert sorted(r.status_code for r in replies) == [200, 409]


@pytest.mark.parametrize(
    "text",
    [
        "如果你不要替我定义情绪，我会考虑说清边界",
        "他说“不要替我定义情绪”",
        "我不想表达边界",
        "我以前说过不要替我定义情绪",
    ],
)
async def test_ambiguous_or_historical_intents_do_not_act(v2, text):
    client, _ = v2
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "speak", text=text)
    assert "boundary" not in save["state"]["flags"]


async def test_explicit_intent_and_deterministic_finance(v2):
    client, _ = v2
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "speak", text="请不要替我定义情绪，我们只讨论事情。")
    assert "boundary" in save["state"]["flags"]
    credit = save["state"]["credit"]
    await act(client, save, "speak", text="请不要替我定义情绪。")
    assert save["state"]["credit"] == credit
    await act(client, save, "next")
    await act(client, save, "speak", "li", "还缺哪些材料？")
    assert "requirements" in save["state"]["flags"]
    await act(client, save, "supplement", params={"evidence": ["quote", "purpose"]})
    await act(client, save, "approve_purchase", "li")
    assert save["state"]["procurement"] == "approved"


async def test_private_branch_never_enters_coworker_context(v2):
    client, runtime = v2
    save = await create(client)
    await second_act(client, save)
    for action, npc in [
        ("request_materials", "li"),
        ("supplement", "sun"),
        ("approve_purchase", "li"),
    ]:
        await act(
            client,
            save,
            action,
            npc,
            **({"params": {"evidence": ["quote", "purpose"]}} if action == "supplement" else {}),
        )
    await confirm(client, save, "partner_distance")
    await act(client, save, "next")
    for npc in ("sun", "li", "zhang"):
        context = await runtime.service.context_for(
            AgentTurn(
                str(uuid4()),
                (await client.get("/api/auth/me")).json()["id"],
                save["id"],
                TurnInput(request_id=uuid4(), version=save["version"], npc=npc),
            )
        )
        assert all(
            word not in context.model_dump_json()
            for word in ("谢川", "妈妈", "partner_distance", "personal_resolved")
        )


async def test_snapshot_branch_has_no_future_history(v2):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    points = (await client.get(f"/api/saves/{save['id']}/snapshots")).json()
    await act(client, save, "speak", text="只存在于原档未来的秘密")
    await act(client, save, "boundary")
    body = {"request_id": str(uuid4()), "snapshot_id": points[0]["id"]}
    response = await client.post(f"/api/saves/{save['id']}/branches", json=body)
    assert response.status_code == 200, response.text
    branch = response.json()
    assert "boundary" not in branch["state"]["flags"]
    replay = await client.post(f"/api/saves/{save['id']}/branches", json=body)
    assert replay.json()["id"] == branch["id"]
    view = (await client.get(f"/api/saves/{branch['id']}/play-state")).json()
    assert "秘密" not in json.dumps(view, ensure_ascii=False)
    async with runtime.sessions() as db:
        source = await db.get(Save, save["id"])
        fork = await db.get(Save, branch["id"])
        assert source.checkpoint_namespace != fork.checkpoint_namespace
        assert not await db.scalar(
            select(func.count()).select_from(Turn).where(Turn.save_id == fork.id)
        )
    await client.post(f"/api/saves/{save['id']}/manage", json={"operation": "delete"})
    await act(client, branch, "boundary")


async def test_guest_story_access_and_deferred_merge(v2):
    client, runtime = v2
    await client.post("/api/auth/logout", json={})
    guest = (await client.post("/api/auth/guest", json={})).json()
    assert guest["identity_type"] == "guest"
    cookie = client.cookies.get("btl_session")
    save = await create(client)
    assert (await client.post("/api/saves", json={})).status_code == 422
    await act(client, save, "begin")
    await act(client, save, "speak", text="你好")
    await act(client, save, "speak", text="你好")
    await act(client, save, "boundary")
    blocked = await client.post(
        f"/api/saves/{save['id']}/turns",
        json={"request_id": str(uuid4()), "version": save["version"], "action": "next"},
    )
    assert blocked.status_code == 422
    await client.post("/api/auth/logout", json={})
    member = (await client.post("/api/auth/dev", json={})).json()
    async with runtime.sessions.begin() as db:
        row = await db.get(Save, save["id"])
        namespace = row.checkpoint_namespace
        db.add(
            OAuthBinding(
                state_hash=digest("fixture-state"),
                guest_id=guest["id"],
                member_id=member["id"],
                status="waiting",
                expires_at=utcnow(),
            )
        )
    await process_bindings(runtime.sessions)
    await process_bindings(runtime.sessions)
    inherited = (await client.get(f"/api/saves/{save['id']}")).json()
    assert inherited["state"] == save["state"]
    async with runtime.sessions() as db:
        row = await db.get(Save, save["id"])
        assert row.checkpoint_namespace == namespace
        assert (
            await db.scalar(
                select(func.count()).select_from(AIJob).where(AIJob.user_id == member["id"])
            )
            == 2
        )
    await act(client, inherited, "next")
    client.cookies.set("btl_session", cookie)
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_visit_does_not_change_plot_version(v2):
    client, _ = v2
    first = await create(client)
    second = await create(client)
    await client.post(f"/api/saves/{first['id']}/visit", json={})
    saves = (await client.get("/api/saves")).json()
    assert saves[0]["id"] == first["id"]
    assert saves[0]["version"] == 0
    stamp = saves[0]["last_played_at"]
    for _ in range(2):
        await client.get(f"/api/saves/{second['id']}/play-state")
    assert (await client.get("/api/saves")).json()[0]["last_played_at"] == stamp


async def test_reflection_and_cards_are_persistent_and_sourced(v2):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    async with runtime.sessions.begin() as db:
        source = ZhihuContent(
            content_type="answer",
            content_id="reviewed",
            title="经过审核的沟通讨论",
            summary="先区分事实和解释。",
            source_url="https://www.zhihu.com/question/1/answer/2",
            author_name="作者",
            vote_count=0,
            comment_count=0,
            topics=["1"],
            fetched_at=utcnow(),
            review_status="approved",
        )
        source.content_hash = content_hash(source)
        db.add(source)
    body = {"request_id": str(uuid4()), "version": save["version"], "kind": "discussion"}
    created = await client.post(f"/api/saves/{save['id']}/jobs", json=body)
    assert created.status_code == 200, created.text
    await asyncio.gather(*runtime.jobs.tasks)
    jobs = (await client.get(f"/api/saves/{save['id']}/jobs")).json()
    card = jobs[0]["result"]["cards"][0]
    assert card["sources"][0]["author"] == "作者"
    await act(
        client,
        save,
        "speak",
        text=card["expression"],
        discussion_id=jobs[0]["id"],
        perspective_id=card["id"],
    )
    other = await create(client)
    await act(client, other, "begin")
    invalid = await client.post(
        f"/api/saves/{other['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": other["version"],
            "text": "你好",
            "discussion_id": jobs[0]["id"],
            "perspective_id": card["id"],
        },
    )
    assert invalid.status_code == 422
    await act(client, save, "draft_exit", params={"kind": "resign", "reason": "希望更换工作环境"})
    await confirm(client, save, "leave")
    body = {"request_id": str(uuid4()), "version": save["version"], "kind": "reflection"}
    response = await client.post(f"/api/saves/{save['id']}/jobs", json=body)
    assert response.status_code == 200, response.text
    await asyncio.gather(*runtime.jobs.tasks)
    items = (await client.get(f"/api/saves/{save['id']}/jobs")).json()
    reflection = next(j for j in items if j["kind"] == "reflection")
    events = (await client.get(f"/api/saves/{save['id']}/events")).json()
    by_id = {e["id"]: e for e in events}
    assert reflection["status"] == "completed"
    for node in reflection["result"]["nodes"]:
        event = by_id[node["event_id"]]
        assert node["actual_expression"] == (
            event["text"]
            if event.get("action") == "speak" and event.get("speaker") == "player"
            else ""
        )
    assert (await client.post(f"/api/saves/{save['id']}/jobs", json=body)).json()[
        "id"
    ] == reflection["id"]


async def test_diagnostics_whitelist_and_save_management(v2):
    client, _runtime = v2
    save = await create(client)
    assert (
        await client.post("/api/diagnostics", json={"kind": "query", "text": "secret"})
    ).status_code == 422
    assert (
        await client.post(
            "/api/diagnostics",
            json={"kind": "query", "stack": "secret ?code=abc /assets/app-123.js:12:9"},
        )
    ).status_code == 200
    for operation in ("archive", "unarchive", "delete", "restore"):
        response = await client.post(
            f"/api/saves/{save['id']}/manage", json={"operation": operation}
        )
        assert response.status_code == 200
        assert response.json()["version"] == 0
    assert (
        await client.post("/api/feedback", json={"text": "想看清不同选择的后果"})
    ).status_code == 200
    assert (
        await client.post("/api/product-events", json={"name": "recap_viewed"})
    ).status_code == 200


async def test_model_major_intent_only_creates_a_proposal(v2):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "draft_exit", params={"kind": "resign", "reason": "希望更换工作环境"})
    result, _ = await act(client, save, "speak", text="确认提交退出申请")
    assert result["proposal"]["action"] == "submit_exit"
    assert save["state"]["ending"] is None
    await act(client, save, "submit_exit", proposal_id=result["proposal"]["id"])
    async with runtime.sessions() as db:
        proposal = await db.get(Proposal, result["proposal"]["id"])
        assert proposal.status == "confirmed"


async def test_intent_fact_survives_a_later_reply_failure(v2):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")

    async def failing(turn, checkpointer):
        await runtime.service.player_intent(turn.id, "sun", "boundary", turn.input.text)
        raise RuntimeError("fixture after commit")
        yield "unreachable"  # pragma: no cover

    runtime.runner.reply = failing
    response = await client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "text": "请不要替我定义情绪。",
        },
    )
    assert '"status": "failed"' in response.text
    saved = (await client.get(f"/api/saves/{save['id']}")).json()
    assert saved["state"]["credit"] == 55
    assert "boundary" in saved["state"]["flags"]
    assert "fixture after commit" not in response.text
