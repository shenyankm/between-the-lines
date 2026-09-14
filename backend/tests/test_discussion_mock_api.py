"""Mock presentation must remain save-scoped and never impersonate live sources."""

import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from app.content import content_hash
from app.db import Save, ZhihuContent, utcnow

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("revision,enabled", [(3, True), (3, False), (1, True)])
async def test_mock_discussion_respects_revision_setting_and_idempotency(
    app, monkeypatch, revision, enabled
):
    app.state.settings.discussions_enabled = enabled
    search = AsyncMock(side_effect=AssertionError("Mock must not query live sources"))
    monkeypatch.setattr("app.zhihu_search.topic_sources", search)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        await client.post("/api/auth/dev", json={})
        saved = (await client.post("/api/saves", json={"story_version": 3})).json()
        runtime = app.state.runtime
        async with runtime.sessions.begin() as db:
            stored = await db.get(Save, saved["id"])
            stored.state = {**stored.state, "content_revision": revision, "act": 1, "node": "act_1"}
            before = stored.state.copy()
            source = ZhihuContent(
                content_type="answer",
                content_id="mock-source",
                title="已审核资料",
                summary="事实与解释需要区分。",
                source_url="https://www.zhihu.com/question/1/answer/2",
                author_name="资料作者",
                vote_count=0,
                comment_count=0,
                topics=["1"],
                fetched_at=utcnow(),
                review_status="approved",
            )
            source.content_hash = content_hash(source)
            db.add(source)
        body = {"request_id": str(uuid4()), "version": saved["version"], "kind": "discussion"}
        response = await client.post(f"/api/saves/{saved['id']}/jobs", json=body)
        if revision == 1:
            assert response.status_code == 422
            search.assert_not_called()
            return
        assert response.status_code == 200, response.text
        await asyncio.gather(*runtime.jobs.tasks)
        replay = await client.post(f"/api/saves/{saved['id']}/jobs", json=body)
        assert replay.json()["id"] == response.json()["id"]
        job = (await client.get(f"/api/saves/{saved['id']}/jobs")).json()[0]
        result = job["result"]
        assert job["status"] == "completed"
        if revision >= 2 and enabled:
            assert result["mock"] is True
            assert len(result["cards"]) == 3
            assert all(card["sources"] == [] for card in result["cards"])
        elif not enabled:
            assert result.get("mock") is not True
            assert all(card["sources"] == [] for card in result["cards"])
        else:
            assert result["cards"][0]["sources"][0]["author"] == "资料作者"
        search.assert_not_called()
        async with runtime.sessions() as db:
            assert (await db.get(Save, saved["id"])).state == before
