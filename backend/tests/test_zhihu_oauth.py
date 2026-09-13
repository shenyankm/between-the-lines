import time
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from starlette.requests import Request

from app import zhihu_oauth as oauth
from app.config import Settings

pytestmark = pytest.mark.unit


def test_schema_diagnostic_contains_types_without_personal_values():
    result = oauth.response_shape({"data": {"uid": "private-user-id", "name": "private-name"}})
    assert result == {"data": {"uid": "str", "name": "str"}}
    assert "private" not in str(result)


def request(query=None, session=None):
    return Request(
        {
            "type": "http",
            "query_string": urlencode(query or {}, doseq=True).encode(),
            "session": session if session is not None else {},
        }
    )


def settings(**kwargs):
    values = dict(
        _env_file=None,
        environment="test",
        zhihu_protocol="hackathon",
        zhihu_client_id="fixture-app",
        zhihu_client_secret="fixture-key",
        zhihu_access_secret="fixture-access",
        public_origin="https://game.example",
        zhihu_authorize_url="https://provider.example/authorize",
        zhihu_token_url="https://provider.example/access_token",
        zhihu_userinfo_url="https://provider.example/user",
    )
    values.update(kwargs)
    return Settings(**values)


def test_authorize_uses_app_id_without_secrets_and_requires_access_secret():
    req = request()
    response = oauth.authorize(req, settings(), "fixture-state")
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query == {
        "app_id": ["fixture-app"],
        "state": ["fixture-state"],
        "response_type": ["code"],
        "redirect_uri": ["https://game.example/api/auth/zhihu/callback"],
    }
    assert req.session["zhihu_hackathon"]["state"] == "fixture-state"
    assert settings().oauth_ready
    assert not settings(zhihu_access_secret="").oauth_ready


@pytest.mark.parametrize("field", ["authorization_code", "code"])
def test_callback_consumes_state_and_accepts_documented_code(field):
    session = {"zhihu_hackathon": {"state": "fixture-state", "issued_at": time.time()}}
    req = request({"state": "fixture-state", field: "fixture-code"}, session)
    assert oauth.consume_code(req) == "fixture-code"
    with pytest.raises(oauth.OAuthStateInvalid):
        oauth.consume_code(req)


@pytest.mark.parametrize(
    "query,age",
    [
        ({"authorization_code": "code"}, 0),
        ({"state": "wrong", "code": "code"}, 0),
        ({"state": ["fixture-state", "wrong"], "code": "code"}, 0),
        ({"state": "fixture-state", "code": "code"}, 601),
        ({"state": "fixture-state", "code": "code"}, -60),
        ({"state": "fixture-state", "code": "code", "authorization_code": "other"}, 0),
        ({"state": "fixture-state", "code": ["code", "other"]}, 0),
        ({"state": "fixture-state"}, 0),
        ({"state": "fixture-state", "code": "code", "error": "access_denied"}, 0),
    ],
)
def test_unsafe_callbacks_fail_before_token_exchange(query, age):
    req = request(
        query,
        {
            "zhihu_hackathon": {
                "state": "fixture-state",
                "issued_at": time.time() - age,
            }
        },
    )
    with pytest.raises(ValueError):
        oauth.consume_code(req)
    assert "zhihu_hackathon" not in req.session


@pytest.mark.parametrize("envelope", [None, "data", "Data"])
@pytest.mark.parametrize("subject_field", ["id", "uid"])
async def test_exchange_uses_oauth_bearer_for_native_identity(monkeypatch, envelope, subject_field):
    calls = []

    def handler(req):
        calls.append(req)
        if req.url.path == "/access_token":
            form = parse_qs(req.content.decode())
            assert form == {
                "app_id": ["fixture-app"],
                "app_key": ["fixture-key"],
                "code": ["fixture-code"],
                "grant_type": ["authorization_code"],
                "redirect_uri": ["https://game.example/api/auth/zhihu/callback"],
            }
            data = {"access_token": "fixture-token"}
            return httpx.Response(200, json={"code": 20000, envelope: data} if envelope else data)
        assert req.headers["Authorization"] == "Bearer fixture-token"
        assert "X-OAuth-Token" not in req.headers
        assert "fixture-access" not in str(req.headers)
        assert abs(int(req.headers["X-Request-Timestamp"]) - time.time()) < 5
        return httpx.Response(
            200, json={"data": {subject_field: "stable-user", "fullname": "玩家"}}
        )

    client = httpx.AsyncClient
    monkeypatch.setattr(
        oauth.httpx,
        "AsyncClient",
        lambda **kw: client(transport=httpx.MockTransport(handler), **kw),
    )
    profile = await oauth.exchange(settings(zhihu_subject_field=subject_field), "fixture-code")
    assert profile[subject_field] == "stable-user"
    assert len(calls) == 2


@pytest.mark.parametrize("profile", [{"name": "不能充当身份"}, {"id": True}, {"id": ""}])
async def test_no_identity_fallback(monkeypatch, profile):
    def handler(req):
        return httpx.Response(
            200,
            json=(
                {"access_token": "fixture-token"} if req.url.path == "/access_token" else profile
            ),
        )

    client = httpx.AsyncClient
    monkeypatch.setattr(
        oauth.httpx,
        "AsyncClient",
        lambda **kw: client(transport=httpx.MockTransport(handler), **kw),
    )
    with pytest.raises(oauth.OAuthIdentityMissing):
        await oauth.exchange(settings(), "fixture-code")


async def test_token_redirect_does_not_forward_credentials(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(307, headers={"Location": "https://other.example/token"})

    client = httpx.AsyncClient
    monkeypatch.setattr(
        oauth.httpx,
        "AsyncClient",
        lambda **kw: client(transport=httpx.MockTransport(handler), **kw),
    )
    with pytest.raises(httpx.HTTPStatusError):
        await oauth.exchange(settings(), "fixture-code")
    assert len(calls) == 1


async def test_provider_business_error_never_creates_an_identity(monkeypatch):
    def handler(req):
        return httpx.Response(
            200,
            json=(
                {"access_token": "fixture-token"}
                if req.url.path == "/access_token"
                else {"code": 20005, "data": "Invalid token"}
            ),
        )

    client = httpx.AsyncClient
    monkeypatch.setattr(
        oauth.httpx,
        "AsyncClient",
        lambda **kw: client(transport=httpx.MockTransport(handler), **kw),
    )
    with pytest.raises(oauth.OAuthProfileRejected):
        await oauth.exchange(settings(), "fixture-code")
