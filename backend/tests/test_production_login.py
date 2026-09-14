"""Production access policy with isolated PostgreSQL and mock model execution."""

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from test_product_v2 import create
from test_product_v2 import v2 as product_fixture

from app.db import AIJob, Save, Turn, User, utcnow

pytestmark = pytest.mark.integration
v2 = product_fixture


@pytest.mark.parametrize("identity", ["guest", "dev", "zhihu", "anonymous"])
async def test_production_access_and_existing_sessions(v2, identity):
    client, runtime = v2
    if identity == "guest":
        await client.post("/api/auth/logout", json={})
        await client.post("/api/auth/guest", json={})
    user = (await client.get("/api/auth/me")).json()
    save = await create(client)
    if identity == "zhihu":
        async with runtime.sessions.begin() as db:
            row = await db.get(User, user["id"])
            row.subject = "zhihu:fixture"
    if identity == "anonymous":
        client.cookies.clear()
    # Change access policy after seeding an existing session. No real model or OAuth calls.
    runtime.settings.environment = "production"
    config = (await client.get("/api/config")).json()
    assert config["guest_login"] is False and config["dev_login"] is False
    for route in ("guest", "dev"):
        assert (await client.post(f"/api/auth/{route}", json={})).status_code == 404
    assert (await client.get("/api/story")).status_code == 200
    me = await client.get("/api/auth/me")
    if identity == "anonymous":
        assert me.status_code == 401
    else:
        assert me.json()["can_play"] == (identity == "zhihu")
    path = f"/api/saves/{save['id']}"
    if identity == "zhihu":
        assert (await client.get(path)).status_code == 200
        assert (await client.post("/api/saves", json={})).status_code == 200
        return
    endpoints = [
        ("GET", "/api/saves"),
        ("POST", "/api/saves"),
        ("GET", path),
        ("GET", path + "/play-state"),
        ("GET", path + "/events"),
        ("GET", path + f"/events/{uuid4()}"),
        ("GET", path + f"/turns/{uuid4()}"),
        ("POST", path + "/turns"),
        ("POST", path + "/reading"),
        ("POST", path + "/visit"),
        ("POST", path + "/manage"),
        ("GET", path + "/snapshots"),
        ("POST", path + "/branches"),
        ("GET", path + "/jobs"),
        ("POST", path + "/jobs"),
        ("POST", "/api/feedback"),
        ("POST", "/api/diagnostics"),
        ("POST", "/api/product-events"),
    ]
    for method, url in endpoints:
        response = await client.request(method, url, **({"json": {}} if method == "POST" else {}))
        assert response.status_code == (401 if identity == "anonymous" else 403), (
            url,
            response.text,
        )
        error = response.json()["error"]
        assert error["code"] == (
            "not_authenticated" if identity == "anonymous" else "zhihu_login_required"
        )
        assert error["recovery"] == "login"
    async with runtime.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(Save)) == 1
        for model in (Turn, AIJob):
            assert await db.scalar(select(func.count()).select_from(model)) == 0
    if identity == "guest":
        async with runtime.sessions.begin() as db:
            row = await db.get(User, user["id"])
            row.guest_expires_at = utcnow() - timedelta(seconds=1)
        assert (await client.get("/api/auth/me")).status_code == 401
    assert (await client.post("/api/auth/logout", json={})).status_code == 200


async def test_declined_or_invalid_authorization_keeps_guest_progress(v2, monkeypatch):
    from urllib.parse import parse_qs, urlsplit

    from app import zhihu_oauth

    client, runtime = v2
    await client.post("/api/auth/logout", json={})
    guest = (await client.post("/api/auth/guest", json={})).json()
    save = await create(client)
    cookie = client.cookies.get("btl_session")
    for key, value in {
        "environment": "production",
        "zhihu_protocol": "hackathon",
        "zhihu_client_id": "fixture",
        "zhihu_client_secret": "fixture",
        "zhihu_access_secret": "fixture",
        "zhihu_authorize_url": "https://partner.example/authorize",
        "zhihu_token_url": "https://partner.example/token",
        "zhihu_userinfo_url": "https://partner.example/user",
    }.items():
        setattr(runtime.settings, key, value)
    client.base_url = "https://test"

    async def unexpected_exchange(*args):
        raise AssertionError("A declined or invalid callback must not exchange a code")

    monkeypatch.setattr(zhihu_oauth, "exchange", unexpected_exchange)
    for declined in (True, False):
        redirect = await client.get("/api/auth/zhihu")
        state = parse_qs(urlsplit(redirect.headers["location"]).query)["state"][0]
        params = (
            {"state": state, "error": "access_denied"}
            if declined
            else {"state": "invalid", "code": "fixture"}
        )
        assert (await client.get("/api/auth/zhihu/callback", params=params)).status_code == 400
        assert client.cookies.get("btl_session") == cookie
        assert (await client.get("/api/auth/me")).json()["id"] == guest["id"]
        async with runtime.sessions() as db:
            row = await db.get(Save, save["id"])
            assert row.user_id == guest["id"] and row.state == save["state"]
            assert not (await db.get(User, guest["id"])).merged_into
