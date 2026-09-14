"""Recovery, retention and admission edge cases supplement the full product journeys."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage
from sqlalchemy import select
from test_product_v2 import (
    act,
    confirm,
    create,
)
from test_product_v2 import (
    v2 as product_fixture,
)

from app.budget import reservation, reserve_job, settle
from app.config import Settings
from app.db import (
    AIJob,
    AISpend,
    OAuthBinding,
    ProductEvent,
    Save,
    Turn,
    User,
    utcnow,
)
from app.errors import ApiError
from app.jobs import editorial
from app.product import process_bindings, rate_limit

pytestmark = pytest.mark.integration
v2 = product_fixture


async def test_rate_limit_reset_and_retry(v2):
    _client, runtime = v2
    async with runtime.sessions.begin() as db:
        await rate_limit(db, "edge-rate", 1, 1)
    async with runtime.sessions.begin() as db:
        with pytest.raises(ApiError) as error:
            await rate_limit(db, "edge-rate", 1, 1)
        assert error.value.status_code == 429
    from app.db import RateBucket

    async with runtime.sessions.begin() as db:
        row = await db.get(RateBucket, "edge-rate")
        row.expires_at = utcnow() - timedelta(seconds=1)
    async with runtime.sessions.begin() as db:
        await rate_limit(db, "edge-rate", 1, 1)


async def test_admission_reserves_global_budget_and_survives_save_cleanup(v2):
    client, runtime = v2
    save = await create(client)
    settings = Settings(
        _env_file=None,
        environment="test",
        agent_mode="deepseek",
        deepseek_api_key="fixture",
        monthly_cost_cap_usd=reservation(runtime.settings) + 0.000001,
    )
    user_id = (await client.get("/api/auth/me")).json()["id"]
    async with runtime.sessions.begin() as db:
        user = await db.get(User, user_id)
        job = await reserve_job(db, settings, user, save["id"], str(uuid4()), "turn", {})
        job_id = job.id
    async with runtime.sessions.begin() as db:
        user = await db.get(User, user_id)
        with pytest.raises(ApiError) as failure:
            await reserve_job(db, settings, user, save["id"], str(uuid4()), "turn", {})
        assert failure.value.code == "monthly_cost_cap_reached"
    async with runtime.sessions.begin() as db:
        job = await db.get(AIJob, job_id)
        await settle(db, job, settings, {"input_tokens": 100, "output_tokens": 20}, True)
    async with runtime.sessions() as db:
        ledger = await db.get(AISpend, job_id)
        assert ledger.status == "unknown" and ledger.reserved_usd > 0 and ledger.cost_usd > 0
    async with runtime.sessions.begin() as db:
        source = await db.get(Save, save["id"])
        await db.delete(source)
    async with runtime.sessions() as db:
        assert await db.get(AISpend, job_id) is not None


async def test_budget_parallel_different_users_has_one_winner(v2):
    client, runtime = v2
    first = await create(client)
    first_user = (await client.get("/api/auth/me")).json()["id"]
    await client.post("/api/auth/logout", json={})
    second_user = (await client.post("/api/auth/dev", json={})).json()["id"]
    second = await create(client)
    settings = Settings(
        _env_file=None,
        environment="test",
        agent_mode="deepseek",
        deepseek_api_key="fixture",
        monthly_cost_cap_usd=reservation(runtime.settings) + 0.000001,
    )

    async def reserve(user_id, save_id):
        try:
            async with runtime.sessions.begin() as db:
                user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
                await reserve_job(db, settings, user, save_id, str(uuid4()), "turn", {})
            return "accepted"
        except ApiError as e:
            return e.code

    assert sorted(
        await asyncio.gather(reserve(first_user, first["id"]), reserve(second_user, second["id"]))
    ) == ["accepted", "monthly_cost_cap_reached"]


async def test_generator_repairs_schema_once_and_backfills_sources(v2, monkeypatch):
    _client, runtime = v2
    calls = []
    closed = []

    class FakeModel:
        root_client = SimpleNamespace(close=lambda: closed.append("sync"))

        @property
        def root_async_client(self):
            return self

        async def close(self):
            closed.append("async")

        async def ainvoke(self, messages, *, response_format):
            assert response_format == {"type": "json_object"}
            calls.append(messages.copy())
            if len(calls) == 1:
                return AIMessage(
                    content="not JSON",
                    usage_metadata={"input_tokens": 10, "output_tokens": 10, "total_tokens": 20},
                )
            return AIMessage(
                content='{"cards":[{"view":"事实与解释分开","situation":"发生分歧","expression":"请先核对事实","possible_cost":"需要沟通时间","source_ids":["source-1"]}]}',
                usage_metadata={"input_tokens": 10, "output_tokens": 10, "total_tokens": 20},
            )

    from app import jobs

    monkeypatch.setattr(jobs, "make_model", lambda _: FakeModel())
    payload = {
        "sources": [
            {
                "id": "source-1",
                "title": "真实标题",
                "author": "真实作者",
                "url": "https://www.zhihu.com/question/1",
                "summary": "公开资料",
            }
        ]
    }
    usage = {}
    raw = await runtime.jobs.generate("discussion", payload, usage)
    value = runtime.jobs.validate("discussion", payload, raw)
    assert value["cards"][0]["sources"][0]["title"] == "真实标题"
    assert len(calls) == 2 and usage["model_calls"] == 2 and set(closed) == {"sync", "async"}
    raw["cards"][0]["source_ids"] = ["forged"]
    with pytest.raises(KeyError):
        runtime.jobs.validate("discussion", payload, raw)
    with pytest.raises(ValueError):
        runtime.jobs.validate(
            "reflection",
            {"facts": []},
            {
                "nodes": [
                    {"event_id": "x", "alternative": "a", "possible_cost": "b"},
                    {"event_id": "x", "alternative": "a", "possible_cost": "b"},
                ]
            },
        )


async def test_generator_failures_and_restart_preserve_facts_and_unknown_cost(v2, monkeypatch):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "draft_exit", params={"kind": "resign", "reason": "希望更换工作环境"})
    await confirm(client, save, "leave")
    settings = runtime.settings.model_copy(
        update={"agent_mode": "deepseek", "deepseek_api_key": "fixture"}
    )
    runtime.service.settings = settings

    async def failing(*args):
        raise ValueError("fixture source must never reach logs")

    monkeypatch.setattr(runtime.jobs, "generate", failing)
    response = await client.post(
        f"/api/saves/{save['id']}/jobs",
        json={"kind": "reflection", "version": save["version"], "request_id": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    await asyncio.gather(*runtime.jobs.tasks)
    job = (await client.get(f"/api/saves/{save['id']}/jobs")).json()[0]
    assert job["status"] == "unknown" and job["result"]["nodes"]
    async with runtime.sessions.begin() as db:
        row = await db.get(AIJob, job["id"])
        row.status = "running"
    await runtime.jobs.recover()
    async with runtime.sessions() as db:
        row = await db.get(AIJob, job["id"])
        ledger = await db.get(AISpend, job["id"])
        assert row.status == "unknown" and ledger.reserved_usd > 0
    assert not runtime.jobs.active


async def test_cached_editorial_does_not_spend_quota_or_allow_cross_act_reference(v2):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    runtime.settings.daily_turn_limit = 0
    body = {"kind": "discussion", "version": save["version"], "request_id": str(uuid4())}
    first = (await client.post(f"/api/saves/{save['id']}/jobs", json=body)).json()
    assert first["result"] == editorial()
    again = (await client.post(f"/api/saves/{save['id']}/jobs", json=body)).json()
    assert again["id"] == first["id"]
    conflicting = await client.post(
        f"/api/saves/{save['id']}/jobs", json={**body, "kind": "reflection"}
    )
    assert conflicting.status_code == 409
    invalid = await client.post(
        f"/api/saves/{save['id']}/jobs",
        json={**body, "request_id": str(uuid4()), "kind": "reflection"},
    )
    assert invalid.status_code == 422
    async with runtime.sessions() as db:
        assert not (await db.scalars(select(AISpend))).all()
    await act(client, save, "boundary")
    await act(client, save, "next")
    runtime.settings.daily_turn_limit = 100
    invalid = await client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "text": "引用上一幕",
            "discussion_id": first["id"],
            "perspective_id": "editorial",
        },
    )
    assert invalid.status_code == 422


async def test_archive_capacity_pagination_and_catalogue_permissions(v2):
    client, runtime = v2
    runtime.settings.active_save_limit = 1
    save = await create(client)
    assert (await client.post("/api/saves", json={})).status_code == 422
    await client.post(f"/api/saves/{save['id']}/manage", json={"operation": "archive"})
    other = await create(client)
    assert (
        await client.post(f"/api/saves/{save['id']}/manage", json={"operation": "unarchive"})
    ).status_code == 422
    await act(client, other, "begin")
    for invalid in (
        "approve_purchase",
        "support_project",
        "joint_review",
        "verify_notice",
        "partner_distance",
    ):
        result = await client.post(
            f"/api/saves/{other['id']}/turns",
            json={"request_id": str(uuid4()), "version": other["version"], "action": invalid},
        )
        assert result.status_code in {409, 422}
    page = (await client.get(f"/api/saves/{other['id']}/events?limit=1")).json()
    assert len(page) == 1
    previous = await client.get(f"/api/saves/{other['id']}/events?before={page[0]['id']}&limit=1")
    assert previous.json() == []
    assert (
        await client.get(f"/api/saves/{other['id']}/events?before={uuid4()}")
    ).status_code == 404
    assert (
        await client.post(
            f"/api/saves/{other['id']}/branches",
            json={"snapshot_id": str(uuid4()), "request_id": str(uuid4())},
        )
    ).status_code == 422
    unknown = await client.get("/api/story?story_id=missing")
    assert unknown.status_code == 404
    story = await client.get("/api/story?version=2")
    etag = story.headers["etag"]
    cached = await client.get("/api/story?version=2", headers={"if-none-match": etag})
    assert cached.status_code == 304
    assert cached.headers["cache-control"].startswith("public")


async def test_binding_waits_for_inflight_turn_and_expired_guest_is_rejected(v2):
    client, runtime = v2
    member = (await client.get("/api/auth/me")).json()["id"]
    await client.post("/api/auth/logout", json={})
    guest = (await client.post("/api/auth/guest", json={})).json()
    save = await create(client)
    async with runtime.sessions.begin() as db:
        turn = Turn(
            save_id=save["id"],
            user_id=guest["id"],
            request_id=str(uuid4()),
            payload={"action": "speak", "npc": "sun", "text": "fixture", "version": 0},
            status="running",
        )
        db.add(turn)
        db.add(
            OAuthBinding(
                state_hash="fixture-wait",
                guest_id=guest["id"],
                member_id=member,
                status="waiting",
                expires_at=utcnow() + timedelta(minutes=2),
            )
        )
        await db.flush()
        turn_id = turn.id
    await process_bindings(runtime.sessions)
    async with runtime.sessions() as db:
        assert (await db.get(Save, save["id"])).user_id == guest["id"]
    await runtime.service.finish_turn(turn_id, None, {}, True)
    await process_bindings(runtime.sessions)
    async with runtime.sessions() as db:
        assert (await db.get(Save, save["id"])).user_id == member
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.clear()
    expired = (await client.post("/api/auth/guest", json={})).json()
    async with runtime.sessions.begin() as db:
        row = await db.get(User, expired["id"])
        row.guest_expires_at = utcnow() - timedelta(seconds=1)
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_public_diagnostic_contains_only_static_stack_frames(v2):
    client, runtime = v2
    await client.post(
        "/api/diagnostics",
        json={
            "kind": "uncaught",
            "stack": "OAuth code=secret /assets/index-a8.js:23:4 user private dialogue",
        },
    )
    async with runtime.sessions() as db:
        row = await db.scalar(select(ProductEvent).where(ProductEvent.name == "diagnostic"))
        assert row.data["stack"] == "/assets/index-a8.js:23:4"
        assert "secret" not in str(row.data)


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("protocol", ["standard", "hackathon"])
async def test_oauth_binding_uses_recorded_state_not_callback_identity(
    v2, existing, protocol, monkeypatch
):
    from fastapi import Response
    from fastapi.responses import RedirectResponse

    from app.auth import issue_session
    from app.domain import initial_state

    client, runtime = v2
    for key, value in {
        "zhihu_client_id": "fixture",
        "zhihu_client_secret": "fixture",
        "zhihu_authorize_url": "https://partner.example/auth",
        "zhihu_token_url": "https://partner.example/token",
        "zhihu_userinfo_url": "https://partner.example/me",
        "zhihu_protocol": protocol,
        "zhihu_access_secret": "fixture-access",
    }.items():
        setattr(runtime.settings, key, value)
    target = None
    if existing:
        target = await issue_session("zhihu:binding-test", "原玩家", Response(), runtime)
        async with runtime.sessions.begin() as db:
            db.add(Save(user_id=target["id"], state=initial_state().model_dump()))
    await client.post("/api/auth/logout", json={})
    guest = (await client.post("/api/auth/guest", json={})).json()
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "speak", text="请不要替我定义情绪。")
    async with runtime.sessions() as db:
        namespace = (await db.get(Save, save["id"])).checkpoint_namespace

    class Provider:
        state = ""

        async def authorize_redirect(self, request, url, state):
            self.state = state
            request.session["fixture_state"] = state
            return RedirectResponse("https://partner.example/authorize")

        async def authorize_access_token(self, request):
            if request.query_params.get("state") != request.session.pop("fixture_state", None):
                raise ValueError("invalid state")
            return {"access_token": "fixture"}

        async def get(self, url, token):
            import httpx

            return httpx.Response(
                200,
                json={"id": "binding-test", "name": "知乎玩家"},
                request=httpx.Request("GET", url),
            )

    provider = Provider()
    monkeypatch.setattr(runtime, "oauth", SimpleNamespace(zhihu=provider))
    redirect = await client.get("/api/auth/zhihu")
    assert redirect.status_code == 307
    if protocol == "hackathon":
        from urllib.parse import parse_qs, urlsplit

        from app import zhihu_oauth

        provider.state = parse_qs(urlsplit(redirect.headers["location"]).query)["state"][0]

        async def exchange(settings, code):
            assert code == "fixture"
            return {"id": "binding-test", "name": "知乎玩家"}

        monkeypatch.setattr(zhihu_oauth, "exchange", exchange)
    # Another login changes only the identity cookie; the state-bound guest is still the source.
    await client.post("/api/auth/dev", json={})
    code_field = "authorization_code" if protocol == "hackathon" else "code"
    callback = f"/api/auth/zhihu/callback?{code_field}=fixture&state={provider.state}"
    assert (await client.get(callback)).status_code == 303
    member = (await client.get("/api/auth/me")).json()
    if target:
        assert member["id"] == target["id"]
    saves = (await client.get("/api/saves")).json()
    assert len(saves) == (2 if existing else 1)
    assert any(row["id"] == save["id"] for row in saves)
    assert (await client.get(callback)).status_code == 400
    async with runtime.sessions() as db:
        row = await db.get(Save, save["id"])
        assert row.checkpoint_namespace == namespace and row.user_id == member["id"]
        assert (await db.get(User, guest["id"])).merged_into == member["id"]
        fees = (await db.scalars(select(AISpend).where(AISpend.save_id == save["id"]))).all()
        assert len(fees) == 1 and fees[0].user_id == member["id"]


async def test_guest_saves_use_shared_capacity_and_restore_checks(v2):
    client, runtime = v2
    runtime.settings.active_save_limit = 2
    await client.post("/api/auth/logout", json={})
    await client.post("/api/auth/guest", json={})
    first = await create(client)
    await create(client)
    assert (await client.post("/api/saves", json={})).status_code == 422

    async def manage(save, operation, status=200):
        response = await client.post(
            f"/api/saves/{save['id']}/manage", json={"operation": operation}
        )
        assert response.status_code == status, response.text

    await manage(first, "archive")
    third = await create(client)
    await manage(first, "unarchive", 422)
    await manage(third, "delete")
    await manage(first, "unarchive")
    await manage(first, "delete")
    fourth = await create(client)
    await manage(first, "restore", 422)
    await manage(fourth, "archive")
    await manage(first, "restore")


async def test_ai_view_reflects_reserved_monthly_budget(v2):
    client, runtime = v2
    save = await create(client)
    user = (await client.get("/api/auth/me")).json()["id"]
    runtime.settings.agent_mode = "deepseek"
    runtime.settings.deepseek_api_key = "fixture"
    runtime.settings.monthly_cost_cap_usd = reservation(runtime.settings) * 1.5
    async with runtime.sessions.begin() as db:
        identity = await db.get(User, user)
        await reserve_job(db, runtime.settings, identity, save["id"], str(uuid4()), "turn", {})
    view = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
    assert not view["ai"]["available"] and view["ai"]["remaining"] > 0
    await act(client, save, "begin")


@pytest.mark.unit
@pytest.mark.parametrize(
    "text,action,npc,act",
    [
        ("请不要审核这份材料", "approve_purchase", "li", 2),
        ("请别支持这件事", "support_project", "zhang", 2),
        ("不要向你同步这个风险", "report", "zhang", 2),
        ("材料要求不清楚，暂缓登记", "request_materials", "sun", 2),
        ("你觉得我需要表达自己的边界吗？", "boundary", "sun", 1),
    ],
)
def test_explicit_negation_and_questions_are_not_committed(text, action, npc, act):
    from app.intents import grounded

    assert not grounded(text, action, npc, act)


async def test_reimported_content_requires_fresh_review_only_when_semantics_change(v2):
    from app.content import content_hash
    from app.db import ZhihuContent
    from app.zhihu_import import persist

    _client, runtime = v2
    row = {
        "content_type": "answer",
        "content_id": "review-fixture",
        "title": "资料",
        "summary": "审核原文",
        "source_url": "https://www.zhihu.com/question/1/answer/2",
        "author_name": "作者",
        "topics": ["act_1"],
        "vote_count": 1,
        "comment_count": 0,
        "fetched_at": utcnow(),
    }
    await persist([row], runtime.sessions)
    async with runtime.sessions.begin() as db:
        source = await db.get(ZhihuContent, ("answer", "review-fixture"))
        source.review_status = "approved"
        source.content_hash = content_hash(source)
    await persist([{**row, "vote_count": 10}], runtime.sessions)
    async with runtime.sessions() as db:
        assert (
            await db.get(ZhihuContent, ("answer", "review-fixture"))
        ).review_status == "approved"
    await persist([{**row, "summary": "另一段内容"}], runtime.sessions)
    async with runtime.sessions() as db:
        source = await db.get(ZhihuContent, ("answer", "review-fixture"))
        assert source.review_status == "candidate" and not source.content_hash


async def test_long_dialogue_history_remains_within_request_budget(v2):
    client, _runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    for _ in range(4):
        await act(client, save, "speak", text="我想把今天遇到的事情慢慢说清楚。" * 70)


async def test_orphan_artifact_recovery_waits_for_live_tasks_and_logs_no_private_exception(
    v2, caplog
):
    client, runtime = v2
    save = await create(client)
    user = (await client.get("/api/auth/me")).json()["id"]
    async with runtime.sessions.begin() as db:
        job = AIJob(
            user_id=user,
            save_id=save["id"],
            request_id=str(uuid4()),
            kind="reflection",
            payload={"facts": []},
        )
        db.add(job)
        await db.flush()
        identifier = job.id
    await runtime.jobs.recover(all_running=False)
    async with runtime.sessions.begin() as db:
        row = await db.get(AIJob, identifier)
        assert row.status == "running"
        row.created_at = utcnow() - timedelta(hours=1)
    gate = asyncio.Event()

    async def fatal():
        await gate.wait()
        raise ValueError("PRIVATE_FAULT_FIXTURE")

    task = asyncio.create_task(fatal(), name=f"artifact:{identifier}")
    runtime.jobs.tasks.add(task)
    task.add_done_callback(runtime.jobs.finished)
    await runtime.jobs.recover(all_running=False)
    async with runtime.sessions() as db:
        assert (await db.get(AIJob, identifier)).status == "running"
    gate.set()
    await asyncio.gather(task, return_exceptions=True)
    await runtime.jobs.recover(all_running=False)
    async with runtime.sessions() as db:
        assert (await db.get(AIJob, identifier)).status == "failed"
    assert "PRIVATE_FAULT_FIXTURE" not in caplog.text
    assert "artifact_persistence_failed" in caplog.text


async def test_trial_completion_and_approval_funnel_follow_committed_facts(v2):
    from test_product_v2 import second_act

    client, runtime = v2
    await client.post("/api/auth/logout", json={})
    await client.post("/api/auth/guest", json={})
    trial = await create(client)
    await act(client, trial, "begin")
    await act(client, trial, "speak", text="请不要替我定义情绪。")
    await act(client, trial, "contact_wang", "wang")
    async with runtime.sessions() as db:
        rows = (
            await db.scalars(select(ProductEvent).where(ProductEvent.name == "chapter_completed"))
        ).all()
        assert rows == []  # Responding is not the same as finishing the chapter.
    await client.post("/api/auth/dev", json={})
    save = await create(client)
    await second_act(client, save)
    await act(client, save, "speak", "li", "请审核采购材料。")
    async with runtime.sessions() as db:
        assert await db.scalar(select(ProductEvent.id).where(ProductEvent.name == "approval_stuck"))
    for action, npc in [
        ("request_materials", "sun"),
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
    response = await client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "propose",
            "proposed_action": "cut_ties",
        },
    )
    assert response.status_code == 200
    assert save["state"]["ending"] is None


async def test_running_artifact_blocks_duplicate_generation_but_replays_original_key(
    v2, monkeypatch
):
    client, runtime = v2
    save = await create(client)
    await act(client, save, "begin")
    await act(client, save, "draft_exit", params={"kind": "resign", "reason": "希望更换工作环境"})
    await confirm(client, save, "leave")
    gate = asyncio.Event()
    execute = runtime.jobs.execute

    async def paused(identifier):
        await gate.wait()
        await execute(identifier)

    monkeypatch.setattr(runtime.jobs, "execute", paused)
    body = {"request_id": str(uuid4()), "kind": "reflection", "version": save["version"]}
    try:
        first = await client.post(f"/api/saves/{save['id']}/jobs", json=body)
        assert first.status_code == 200
        duplicate = await client.post(
            f"/api/saves/{save['id']}/jobs", json={**body, "request_id": str(uuid4())}
        )
        assert duplicate.status_code == 409
        replay = await client.post(f"/api/saves/{save['id']}/jobs", json=body)
        assert replay.json()["id"] == first.json()["id"]
    finally:
        gate.set()
        await asyncio.gather(*runtime.jobs.tasks)
    assert len((await client.get(f"/api/saves/{save['id']}/jobs")).json()) == 1
