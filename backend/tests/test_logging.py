"""What the logs may contain, and what they must not.

SECURITY.md promises that an authentication failure records the exception's type
and nothing else. These tests are that promise, checked. They render records
through the real formatter rather than reading `caplog.text`, because caplog
attaches its own handler and never runs this app's -- including the filter that
stamps the request id. Asserting on caplog's rendering would test a pipeline that
nothing in production uses.
"""

import asyncio
import io
import json
import logging
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.logging_setup import (
    _ACCEPTED_ID,
    JsonFormatter,
    RequestIdMiddleware,
    TextFormatter,
    _RequestIdFilter,
    configure_logging,
    request_id,
)
from app.routes import game as game_routes

pytestmark = pytest.mark.integration

# The secrets and private strings a leak would be recognisable by. Every one is a
# fixture: nothing here reads a real credential from the environment.
FAKE_TOKEN = "fixture-access-token-DO-NOT-LOG"
FAKE_KEY = "sk-fixture-DO-NOT-LOG"
PRIVATE_TEXT = "我不想让同事知道我在找工作"


@pytest.fixture
def logged() -> Iterator[io.StringIO]:
    """Capture what the production handler would have written to stdout."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_RequestIdFilter())
    root = logging.getLogger()
    previous_handlers, previous_level = root.handlers[:], root.level
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    try:
        yield stream
    finally:
        root.handlers[:] = previous_handlers
        root.setLevel(previous_level)


def records(stream: io.StringIO) -> list[dict[str, object]]:
    """Parse the captured stdout back into the objects a pipeline would see."""
    return [json.loads(line) for line in stream.getvalue().splitlines() if line]


def dump(stream: io.StringIO) -> str:
    return stream.getvalue()


def clear(stream: io.StringIO) -> None:
    """Forget everything captured so far.

    Several tests need a save walked to the point where a `speak` turn calls the
    model, and each of those turns logs. Counting records without clearing would
    measure the setup rather than the request under test.
    """
    stream.truncate(0)
    stream.seek(0)


class StubOAuth:
    """Stands in for authlib's OAuth registry.

    `oauth.zhihu` resolves through `__getattr__` to a client that only exists once
    registration has succeeded, so monkeypatch cannot set the attribute -- it
    refuses to patch something that is not there. Replacing the registry is the
    direct route, and it also means no test needs a real provider configured.
    """

    def __init__(self, client: object) -> None:
        self.zhihu = client


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    # raise_server_exceptions=False: Starlette re-raises after the 500 handler
    # returns, and a test asserting on the envelope needs the response, not the
    # traceback.
    with TestClient(app, raise_server_exceptions=False) as c:
        assert c.post("/api/auth/dev", json={"name": "日志测试"}).status_code == 200
        yield c


def prepare(client: TestClient) -> dict[str, object]:
    """A save advanced far enough that a `speak` turn will call the model."""
    save = client.post("/api/saves", json={}).json()
    for action in ("begin", "boundary", "next"):
        client.post(
            f"/api/saves/{save['id']}/turns",
            json={"request_id": str(uuid4()), "version": save["version"], "action": action},
        )
        save = client.get(f"/api/saves/{save['id']}").json()
    return save


def oauth_configured(monkeypatch, app) -> None:
    """Make `settings.oauth_ready` true so the callback reaches its try block."""
    for name, value in {
        "zhihu_client_id": "fixture-client",
        "zhihu_client_secret": "fixture-secret",
        "zhihu_authorize_url": "https://partner.example/authorize",
        "zhihu_token_url": "https://partner.example/token",
        "zhihu_userinfo_url": "https://partner.example/userinfo",
    }.items():
        monkeypatch.setattr(app.state.settings, name, value)


def test_oauth_failure_logs_the_type_and_never_the_credential(app, client, logged, monkeypatch):
    oauth_configured(monkeypatch, app)

    class Exploding:
        async def authorize_access_token(self, request):
            # Shaped like the real failure: an OAuth client's error text quotes the
            # request it was making, which carries the code and the bearer token.
            raise RuntimeError(f"exchange failed code={FAKE_TOKEN} key={FAKE_KEY}")

    monkeypatch.setattr(app.state.runtime, "oauth", StubOAuth(Exploding()))

    response = client.get("/api/auth/zhihu/callback?code=test&state=invalid")
    assert response.status_code == 400

    text = dump(logged)
    assert FAKE_TOKEN not in text
    assert FAKE_KEY not in text
    failures = [r for r in records(logged) if r["message"] == "oauth_failed"]
    assert len(failures) == 1
    assert failures[0]["kind"] == "RuntimeError"
    # The response body is the other half of the promise: the player learns the
    # authorisation failed, not why.
    assert FAKE_TOKEN not in response.text
    assert response.json()["error"]["code"] == "oauth_failed"


def test_turn_failure_logs_the_type_and_never_the_message(app, client, logged, monkeypatch):
    save = prepare(client)

    async def failing(turn, checkpointer, usage):
        raise RuntimeError(f"upstream echoed {PRIVATE_TEXT!r} with {FAKE_KEY}")
        yield "unreachable"  # pragma: no cover - keeps this an async generator

    monkeypatch.setattr(app.state.dependencies, "reply", failing)
    clear(logged)
    response = client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "npc": "sun",
            "text": PRIVATE_TEXT,
        },
    )
    assert '"status": "failed"' in response.text

    text = dump(logged)
    assert PRIVATE_TEXT not in text
    assert FAKE_KEY not in text
    failures = [r for r in records(logged) if r["message"] == "turn_failed"]
    assert len(failures) == 1
    assert failures[0]["kind"] == "RuntimeError"
    assert failures[0]["turn_id"]


def dialogue_text(body: str) -> str:
    """The NPC reply from the single `dialogue` frame of an SSE turn response."""
    frames = [
        json.loads(frame.split("data: ", 1)[1])
        for frame in body.split("\n\n")
        if frame.startswith("event: dialogue")
    ]
    assert len(frames) == 1, body
    return str(frames[0]["text"])


def test_a_completed_turn_logs_neither_the_player_text_nor_the_reply(client, logged):
    save = prepare(client)
    clear(logged)
    response = client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "npc": "sun",
            "text": PRIVATE_TEXT,
        },
    )
    assert response.status_code == 200

    # The NPC's reply is streamed to the player and persisted in `events`, both of
    # which are the player's own data. The log is not: it is what an operator with
    # database-less access can read, so dialogue stays out of it entirely.
    reply = dialogue_text(response.text)
    text = dump(logged)
    assert PRIVATE_TEXT not in text
    assert reply not in text

    finished = [r for r in records(logged) if r["message"] == "turn_finished"]
    assert len(finished) == 1
    # What an operator does get is enough to diagnose without reading the game:
    # which turn, which NPC, which action, how it ended, and what it cost. The
    # call count is not pinned to a number -- a speak turn makes however many the
    # agent's tool loop needs, and that is an implementation detail.
    assert finished[0]["npc"] == "sun"
    assert finished[0]["action"] == "speak"
    assert finished[0]["outcome"] == "completed"
    assert finished[0]["turn_id"]
    assert finished[0]["model_calls"] >= 1
    assert finished[0]["mode"] == "mock"
    # Mock mode is free, so a non-zero cost here would mean the estimate is being
    # computed from something other than the mode actually in use.
    assert finished[0]["cost_estimate_usd"] == 0.0


def test_validation_failure_logs_field_names_but_not_submitted_values(client, logged):
    save = client.post("/api/saves", json={}).json()
    # Past the schema's 1500-character bound, so `text` itself fails validation --
    # and FastAPI's exc.errors() echoes the submitted value back in its `input`
    # key. For this API that value is a player's private message, which is what
    # makes logging the error verbatim a leak rather than a style choice.
    overlong = PRIVATE_TEXT * 200
    assert len(overlong) > 1500
    response = client.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": "not-an-int",
            "action": "speak",
            "npc": "sun",
            "text": overlong,
        },
    )
    assert response.status_code == 422, response.text

    text = dump(logged)
    assert PRIVATE_TEXT not in text
    assert "not-an-int" not in text
    # Nor may the response echo it: FastAPI's default 422 body would have.
    assert PRIVATE_TEXT not in response.text
    assert response.json()["error"]["code"] == "validation_failed"

    failures = [r for r in records(logged) if r["message"] == "validation_failed"]
    assert len(failures) == 1
    # `extra={"fields": {...}}` flattens into top-level keys, which is the point:
    # a pipeline filters on .invalid_fields directly rather than decoding a nested
    # object it has to know is there.
    assert failures[0]["path"] == "/api/saves/{save_id}/turns"
    assert failures[0]["invalid_fields"] == "body.text,body.version"


def test_unhandled_error_logs_the_traceback_and_returns_a_constant(client, logged, monkeypatch):
    save = client.post("/api/saves", json={}).json()

    def explode(_save):
        raise RuntimeError(f"connection refused dsn={FAKE_KEY}")

    monkeypatch.setattr(game_routes, "snapshot", explode)
    response = client.get(f"/api/saves/{save['id']}")

    assert response.status_code == 500
    body = response.json()["error"]
    # The response is a constant. No exception text, no dependency name, no DSN.
    assert body["message"] == "服务器内部错误，请稍后重试。"
    assert body["code"] == "internal_error"
    assert FAKE_KEY not in response.text

    unhandled = [r for r in records(logged) if r["message"] == "unhandled_error"]
    assert len(unhandled) == 1
    # The traceback is what makes the 500 diagnosable, and it belongs here only.
    assert "RuntimeError" in str(unhandled[0]["exception"])
    assert FAKE_KEY not in str(unhandled[0]["exception"])


def test_request_id_correlates_the_response_and_the_500_log_line(client, logged, monkeypatch):
    save = client.post("/api/saves", json={}).json()

    def explode(_save):
        raise RuntimeError("boom")

    monkeypatch.setattr(game_routes, "snapshot", explode)
    supplied = f"corr-{uuid4().hex[:12]}"
    response = client.get(f"/api/saves/{save['id']}", headers={"X-Request-Id": supplied})

    assert response.headers["x-request-id"] == supplied
    assert response.json()["error"]["request_id"] == supplied
    # The handler runs after RequestIdMiddleware has unwound and reset its
    # ContextVar, so this only works because the id is also published into the
    # ASGI scope. That is the part worth pinning.
    unhandled = [r for r in records(logged) if r["message"] == "unhandled_error"]
    assert unhandled[0]["request_id"] == supplied


def test_a_supplied_request_id_is_echoed_exactly_once(client):
    supplied = f"trace-{uuid4().hex[:8]}"
    ok = client.get("/api/live", headers={"X-Request-Id": supplied})
    assert ok.status_code == 200
    # An error response is stamped by error_response and then seen by the
    # middleware, which must not stamp it a second time. httpx joins a repeated
    # header with a comma, so a duplicate is visible as "id, id".
    missing = client.get(f"/api/saves/{uuid4()}", headers={"X-Request-Id": supplied})
    assert missing.status_code == 404

    for response in (ok, missing):
        assert response.headers.get_list("x-request-id") == [supplied]


def test_an_absent_request_id_is_generated_and_echoed(client):
    response = client.get("/api/live")
    identifier = response.headers["x-request-id"]
    assert len(identifier) == 32
    int(identifier, 16)  # a uuid4 hex, so a client can assume the shape


@pytest.mark.parametrize(
    "supplied",
    [
        "x" * 65,  # longer than the 64 the pattern allows
        'quote"injection',  # a JSON string delimiter
        "back\\slash",
        "spaced id",
        "id;with;semicolons",
    ],
)
def test_a_hostile_request_id_is_replaced_rather_than_echoed(client, logged, supplied):
    response = client.get("/api/live", headers={"X-Request-Id": supplied})
    echoed = response.headers["x-request-id"]

    assert echoed != supplied
    assert len(echoed) == 32
    assert _ACCEPTED_ID.fullmatch(echoed)
    # The property that matters: the rejected value reaches neither the response
    # header nor any log line. A newline in particular would have let a caller
    # forge a whole record -- one that looks like it came from this application.
    assert supplied not in dump(logged)
    assert supplied not in echoed
    assert "\n" not in echoed


@pytest.mark.parametrize(
    "supplied",
    ["abc\ndef", "tab\there", "null\x00byte", "esc\x1b[31m", "cr\rline", "über"],
)
def test_control_characters_never_match_the_accepted_pattern(supplied):
    # httpx refuses to put a control character or a non-latin-1 value on the wire,
    # so these cannot be exercised through the client. The pattern is the control,
    # so the pattern is what gets tested.
    assert _ACCEPTED_ID.fullmatch(supplied) is None


@pytest.mark.unit
def test_json_formatter_emits_the_envelope_keys():
    record = logging.LogRecord("btl.test", logging.WARNING, __file__, 1, "hello", None, None)
    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "WARNING"
    assert payload["logger"] == "btl.test"
    assert payload["message"] == "hello"
    assert payload["request_id"] == "-"
    assert payload["ts"].endswith("+00:00")


@pytest.mark.unit
def test_json_formatter_keeps_chinese_readable():
    record = logging.LogRecord("btl.test", logging.INFO, __file__, 1, "回合结束", None, None)
    line = JsonFormatter().format(record)
    # ensure_ascii=False is a deliberate choice: \u56de\u5408 in a log search box
    # is a string nobody can grep for.
    assert "回合结束" in line


@pytest.mark.unit
def test_extra_fields_become_real_keys_not_an_embedded_string():
    record = logging.LogRecord("btl.test", logging.INFO, __file__, 1, "turn_finished", None, None)
    record.fields = {"npc": "sun", "model_calls": 3}
    payload = json.loads(JsonFormatter().format(record))
    assert payload["npc"] == "sun"
    assert payload["model_calls"] == 3
    # The point of the above: a pipeline can filter on the value directly.
    assert "model_calls" not in payload["message"]


@pytest.mark.unit
def test_a_field_cannot_overwrite_the_envelope():
    record = logging.LogRecord("btl.test", logging.INFO, __file__, 1, "hi", None, None)
    record.fields = {"level": "CRITICAL", "message": "forged", "ts": "yesterday"}
    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "INFO"
    assert payload["message"] == "hi"
    assert payload["ts"] != "yesterday"


@pytest.mark.unit
def test_a_non_dict_fields_value_is_ignored():
    record = logging.LogRecord("btl.test", logging.INFO, __file__, 1, "hi", None, None)
    record.fields = "not a mapping"
    assert json.loads(JsonFormatter().format(record))["message"] == "hi"


@pytest.mark.unit
def test_text_formatter_carries_the_same_fields_as_key_value():
    record = logging.LogRecord("btl.test", logging.INFO, __file__, 1, "turn_failed", None, None)
    record.__dict__["request_id"] = "req-text"
    record.fields = {"kind": "RuntimeError"}
    line = TextFormatter().format(record)
    assert "[req-text]" in line
    assert "turn_failed" in line
    assert line.endswith("kind=RuntimeError")


@pytest.mark.unit
def test_configure_logging_takes_over_the_uvicorn_loggers(app):
    configure_logging(app.state.settings)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        # Access logs reach stdout through the root handler and therefore through
        # the JSON formatter. Without this, `docker compose logs api | jq -e .`
        # parses every line except the ones uvicorn writes.
        assert logger.handlers == []
        assert logger.propagate is True
    assert request_id.get() == "-"


@pytest.mark.unit
def test_request_id_middleware_passes_a_non_http_scope_straight_through():
    seen: list[str] = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    asyncio.run(RequestIdMiddleware(inner)({"type": "lifespan"}, None, None))
    assert seen == ["lifespan"]
