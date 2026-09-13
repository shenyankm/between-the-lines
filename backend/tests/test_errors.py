"""The error envelope, and a gate that keeps the published vocabulary honest.

The envelope is what a client sees when anything goes wrong, so its shape is the
API's most load-bearing promise: `code` is what a client branches on, and
`message` is prose that may be reworded at any time. These tests pin the shape,
pin that no response carries FastAPI's default `detail`, and then check that the
vocabulary in errors.py and the code under app/ agree in both directions -- a
code raised but unpublished is one no client was told to expect, and one
published but never raised is a promise nothing keeps.
"""

import ast
import json
from collections import defaultdict
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.errors import DERIVED_CODES, VOCABULARY, codes
from app.routes import game as game_routes

pytestmark = pytest.mark.integration

APP_DIR = Path(__file__).resolve().parent.parent / "app"

# Every error body has exactly these keys. Asserting the set rather than the
# presence of three keys is what stops a future field -- a traceback, a
# dependency name, an echoed input -- from being added quietly.
ENVELOPE_KEYS = {"code", "message", "request_id", "recovery"}


@pytest.fixture
def client(app) -> TestClient:
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def player(client) -> TestClient:
    assert client.post("/api/auth/dev", json={"name": "契约测试"}).status_code == 200
    return client


def body(response) -> dict[str, str]:
    """The envelope's inner object, after checking the outer shape."""
    payload = response.json()
    assert set(payload) == {"error"}, payload
    assert (
        ENVELOPE_KEYS <= set(payload["error"]) <= ENVELOPE_KEYS | {"details", "retry_after_seconds"}
    ), payload
    # FastAPI's default is {"detail": ...}. If that key ever reappears, a client
    # branching on `error.code` silently stops working.
    assert "detail" not in payload
    return payload["error"]


def assert_envelope(response, status: int, code: str) -> dict[str, str]:
    assert response.status_code == status, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    error = body(response)
    assert error["code"] == code
    assert error["message"]
    assert error["request_id"]
    # The header and the body agree, so either is enough to quote in a report.
    assert response.headers["x-request-id"] == error["request_id"]
    return error


def test_unauthenticated(player):
    player.post("/api/auth/logout", json={})
    assert_envelope(player.get("/api/auth/me"), 401, "not_authenticated")
    assert_envelope(player.get("/api/saves"), 401, "not_authenticated")


def test_foreign_origin_is_refused_before_the_route_runs(client):
    response = client.post("/api/saves", json={}, headers={"Origin": "https://attacker.example"})
    assert_envelope(response, 403, "forbidden_origin")


def test_a_non_json_mutation_is_refused(client):
    assert_envelope(client.post("/api/saves", content="{}"), 415, "json_required")


def test_unknown_path_and_wrong_method_get_a_derived_code(client):
    # FastAPI raises these itself, with no code, so one is built from the status.
    # Both are envelope errors; neither may fall back to a bare "Not Found".
    assert_envelope(client.get("/api/does-not-exist"), 404, "http_404")
    # client.delete() takes no body, and the guard only lets a JSON mutation reach
    # the router -- so request() is what can stage a method the path rejects.
    assert_envelope(client.request("DELETE", "/api/live", json={}), 405, "http_405")


def test_the_mutation_guard_reaches_a_wrong_method_before_the_router_does(client):
    # protect_mutations runs before routing, so a DELETE with no JSON body is
    # refused as a non-JSON mutation and never gets as far as being a method the
    # path does not accept. Pinning the precedence: a reader would otherwise expect
    # 405 from a path that only answers GET, and get 415.
    assert_envelope(client.delete("/api/live"), 415, "json_required")


def test_another_players_save_is_indistinguishable_from_a_missing_one(player):
    save = player.post("/api/saves", json={}).json()
    player.post("/api/auth/logout", json={})
    player.post("/api/auth/dev", json={"name": "另一个人"})

    # Same status and same code for "not yours" and "not there": the point is that
    # a caller cannot enumerate save ids belonging to other players.
    assert_envelope(player.get(f"/api/saves/{save['id']}"), 404, "save_not_found")
    assert_envelope(player.get(f"/api/saves/{uuid4()}"), 404, "save_not_found")


def test_version_conflict_and_reused_request_id(player):
    save = player.post("/api/saves", json={}).json()
    request_id = str(uuid4())
    payload = {
        "request_id": request_id,
        "version": save["version"],
        "action": "begin",
    }
    assert player.post(f"/api/saves/{save['id']}/turns", json=payload).status_code == 200

    # Same id, different action: the id was already spent on something else.
    reused = dict(payload, action="boundary")
    assert_envelope(
        player.post(f"/api/saves/{save['id']}/turns", json=reused), 409, "request_id_reused"
    )
    # Stale version: the save moved on.
    stale = dict(payload, request_id=str(uuid4()))
    assert_envelope(
        player.post(f"/api/saves/{save['id']}/turns", json=stale), 409, "version_conflict"
    )


def test_an_empty_speak_is_rejected_by_the_domain_not_by_pydantic(player):
    save = player.post("/api/saves", json={}).json()
    response = player.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "npc": "sun",
            "text": "   ",
        },
    )
    # A 422 with its own code, so a client can tell "you sent the wrong shape"
    # apart from "you sent nothing to say" without parsing prose.
    assert_envelope(response, 422, "empty_message")


def test_validation_failure_does_not_echo_the_submitted_value(player):
    save = player.post("/api/saves", json={}).json()
    private = "我不想让同事知道我在找工作" * 200
    response = player.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "npc": "sun",
            "text": private,
        },
    )
    assert_envelope(response, 422, "validation_failed")
    # FastAPI's own 422 body quotes the offending value back. For this API that
    # value is a player's private message.
    assert private not in response.text
    assert response.json()["error"]["message"] == "请求格式不正确。"


def test_a_turn_lookup_misses_with_its_own_code(player):
    save = player.post("/api/saves", json={}).json()
    assert_envelope(player.get(f"/api/saves/{save['id']}/turns/{uuid4()}"), 404, "turn_not_found")


def test_the_daily_limit_429_carries_a_numeric_retry_after(app, player, monkeypatch):
    monkeypatch.setattr(app.state.runtime.service.settings, "daily_turn_limit", 0)
    save = player.post("/api/saves", json={}).json()
    player.post(
        f"/api/saves/{save['id']}/turns",
        json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
    )
    response = player.post(
        f"/api/saves/{save['id']}/turns",
        json={"request_id": str(uuid4()), "version": 1, "action": "speak", "text": "你好"},
    )
    assert_envelope(response, 429, "daily_limit_reached")
    wait = response.headers["retry-after"]
    # Numeric per RFC 9110, so a client can honour it without parsing prose. A
    # retry storm against a saturated single process is what this bounds.
    assert wait.isdigit()
    assert 0 < int(wait) <= 86401


def test_the_concurrency_429_carries_a_numeric_retry_after(app, player, monkeypatch):
    monkeypatch.setattr(app.state.settings, "max_concurrent_turns", 0)
    save = player.post("/api/saves", json={}).json()
    player.post(
        f"/api/saves/{save['id']}/turns",
        json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
    )
    response = player.post(
        f"/api/saves/{save['id']}/turns",
        json={"request_id": str(uuid4()), "version": 1, "action": "speak", "text": "你好"},
    )
    assert_envelope(response, 429, "concurrency_budget_exhausted")
    assert response.headers["retry-after"] == "5"


def test_an_unconfigured_model_is_a_503_not_a_500(app, player, monkeypatch):
    monkeypatch.setattr(app.state.settings, "agent_mode", "deepseek")
    monkeypatch.setattr(app.state.settings, "deepseek_api_key", "")
    save = player.post("/api/saves", json={}).json()
    response = player.post(
        f"/api/saves/{save['id']}/turns",
        json={
            "request_id": str(uuid4()),
            "version": save["version"],
            "action": "speak",
            "npc": "sun",
            "text": "还缺什么材料？",
        },
    )
    assert_envelope(response, 503, "model_unconfigured")


def test_an_unhandled_exception_never_leaks_its_own_text(player, monkeypatch):
    save = player.post("/api/saves", json={}).json()
    secret = "postgresql://user:hunter2@db.internal/btl"

    def explode(_save):
        raise RuntimeError(f"could not connect to {secret}")

    monkeypatch.setattr(game_routes, "snapshot", explode)
    response = player.get(f"/api/saves/{save['id']}")
    assert_envelope(response, 500, "internal_error")
    assert secret not in response.text
    # A constant, so no exception text can reach a client through this path.
    assert response.json()["error"]["message"] == "服务器内部错误，请稍后重试。"


def test_dev_login_is_absent_in_production(app, client, monkeypatch):
    monkeypatch.setattr(app.state.settings, "environment", "production")
    response = client.post("/api/auth/dev", json={"name": "不该存在"})
    # The route is still registered and still answers, so the code is the app's
    # own rather than a derived http_404 -- a client can tell the two apart.
    assert_envelope(response, 404, "not_found")


# --- the vocabulary gate -------------------------------------------------------


def _raised() -> set[tuple[int, str]]:
    """Every (status, code) literal an ApiError or error_response call site uses."""
    found: set[tuple[int, str]] = set()
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            callee = node.func
            name = callee.id if isinstance(callee, ast.Name) else getattr(callee, "attr", "")
            if name not in {"ApiError", "error_response"} or len(node.args) < 2:
                continue
            status, code = node.args[:2]
            # Only literals are collected. A code computed at runtime -- the
            # `http_{status}` fallback in on_http_error -- is listed separately as
            # DERIVED_CODES, so nothing here has to guess at an f-string.
            if isinstance(status, ast.Constant) and isinstance(code, ast.Constant):
                found.add((int(status.value), str(code.value)))
    return found


def _published() -> set[tuple[int, str]]:
    return {(status, code) for status, names in VOCABULARY.items() for code in names}


def test_every_code_the_application_raises_is_published():
    unpublished = _raised() - _published()
    assert not unpublished, f"raised but absent from errors.VOCABULARY: {sorted(unpublished)}"


def test_every_published_code_is_raised_somewhere():
    unraised = _published() - _raised()
    assert not unraised, f"in errors.VOCABULARY but no call site raises it: {sorted(unraised)}"


def test_derived_codes_are_not_expected_at_a_call_site():
    # The walk above cannot see them, so they are declared rather than discovered.
    assert DERIVED_CODES == ("http_404", "http_405")
    assert not _published() & {(status, code) for code in DERIVED_CODES for status in VOCABULARY}


def test_codes_refuses_to_document_an_unpublished_name():
    with pytest.raises(ValueError, match="not_a_real_code"):
        codes(404, "not_a_real_code")
    # And a real code under the wrong status is refused too, which is the mistake
    # a call site is likelier to make.
    with pytest.raises(ValueError, match="save_not_found"):
        codes(409, "save_not_found")


def _documented(app) -> dict[int, set[str]]:
    """Codes the live OpenAPI schema advertises, per status, for envelope bodies."""
    found: dict[int, set[str]] = defaultdict(set)
    for operations in app.openapi()["paths"].values():
        for operation in operations.values():
            for status, response in operation.get("responses", {}).items():
                code = int(status)
                ref = (
                    response.get("content", {})
                    .get("application/json", {})
                    .get("schema", {})
                    .get("$ref", "")
                )
                # Only envelope responses carry codes. /api/ready answers 503 with
                # its own diagnostic payload, and its description is prose on
                # purpose, so filtering on the schema is what keeps it out.
                if code < 400 or not ref.endswith("/ErrorEnvelope"):
                    continue
                found[code] |= set(response.get("description", "").split(" / "))
    return found


def test_the_contract_documents_exactly_the_published_vocabulary(app):
    documented = _documented(app)
    assert documented, "no envelope error response was documented at all"
    for status, names in VOCABULARY.items():
        # A code published here but absent from the contract is one a client
        # reading openapi.json was never told to handle.
        assert set(names) <= documented[status], f"undocumented {status} codes"
        # And one in the contract but not here is a shape the server cannot send.
        assert documented[status] <= set(names), f"contract advertises unknown {status} codes"


def test_every_documented_error_response_is_an_envelope(app):
    for path, operations in app.openapi()["paths"].items():
        for method, operation in operations.items():
            for status, response in operation["responses"].items():
                if int(status) < 400:
                    continue
                content = response.get("content", {}).get("application/json", {})
                ref = content.get("schema", {}).get("$ref", "")
                assert ref.endswith("/ErrorEnvelope") or path == "/api/ready", (
                    f"{method.upper()} {path} {status} documents {ref or 'no schema'}"
                )


def test_no_route_documents_fastapis_validation_shape(app):
    # The committed contract used to advertise HTTPValidationError on five routes,
    # a shape this server has never sent since the envelope handlers landed.
    assert "HTTPValidationError" not in json.dumps(app.openapi())


@pytest.mark.parametrize("path", ["/api/saves/bad-id", f"/api/saves/{uuid4()}/turns/bad-id"])
def test_uuid_paths_reject_invalid_identifiers(player, path):
    error = assert_envelope(player.get(path), 422, "validation_failed")
    assert error["details"][0]["code"] == "uuid_parsing"


def test_validation_unknown_names_are_also_private(client):
    response = client.post(
        "/api/auth/dev", json={"private-key-secret": "private-value-secret", "name": " "}
    )
    error = assert_envelope(response, 422, "validation_failed")
    assert "private-key-secret" not in response.text
    assert "private-value-secret" not in response.text
    assert all(set(issue) == {"field", "code", "message"} for issue in error["details"])


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("get", "/api/config", {}),
        ("get", "/api/auth/me", {}),
        ("post", "/api/saves", {"content": "{}"}),
        ("post", "/api/saves", {"json": {}, "headers": {"Origin": "https://foreign.example"}}),
    ],
)
def test_all_response_paths_carry_no_store_and_correlation(client, method, path, kwargs):
    response = getattr(client, method)(path, **kwargs)
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-request-id"]
