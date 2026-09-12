from urllib.parse import parse_qs, urlparse

import httpx2 as httpx
from fastapi.testclient import TestClient

from app import auth
from app.main import app


def test_oauth_state_validation_and_stable_identity(monkeypatch):
    for name, value in {
        "zhihu_client_id": "fixture-client",
        "zhihu_client_secret": "fixture-secret",
        "zhihu_authorize_url": "https://partner.example/authorize",
        "zhihu_token_url": "https://partner.example/token",
        "zhihu_userinfo_url": "https://partner.example/userinfo",
    }.items():
        monkeypatch.setattr(auth.settings, name, value)

    async def handle(request):
        if request.url.path == "/token":
            return httpx.Response(
                200, json={"access_token": "fixture-token", "token_type": "Bearer"}
            )
        assert request.headers["authorization"] == "Bearer fixture-token"
        return httpx.Response(200, json={"id": "stable-fixture-id", "name": "知乎测试用户"})

    # Partner protocol fixture, not a claim about real Zhihu endpoints or fields.
    auth.oauth.register(
        "zhihu",
        overwrite=True,
        client_id="fixture-client",
        client_secret="fixture-secret",
        authorize_url="https://partner.example/authorize",
        access_token_url="https://partner.example/token",
        client_kwargs={"transport": httpx.MockTransport(handle)},
    )
    with TestClient(app) as client:
        assert client.get("/api/auth/zhihu/callback?code=test&state=invalid").status_code == 400
        identities = []
        for _ in range(2):
            response = client.get("/api/auth/zhihu", follow_redirects=False)
            assert response.status_code == 302
            state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
            callback = client.get(
                f"/api/auth/zhihu/callback?code=test&state={state}", follow_redirects=False
            )
            assert callback.status_code == 303
            assert "fixture-token" not in callback.headers.get("set-cookie", "")
            identities.append(client.get("/api/auth/me").json()["id"])
            client.post("/api/auth/logout", json={})
        assert identities[0] == identities[1]
