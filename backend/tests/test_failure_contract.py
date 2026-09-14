"""Failure categories and legacy output conversion do not require a database."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from langgraph.errors import GraphRecursionError
from pydantic import ValidationError

from app.domain import initial_state
from app.error_catalog import CATALOG, ErrorCode, FailureCode
from app.errors import ApiError
from app.failures import EmptyReplyError, classify_failure
from app.schemas import DevLogin, TurnInput, TurnResult

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (TimeoutError("secret"), FailureCode.TIMEOUT),
        (httpx.ReadTimeout("secret"), FailureCode.TIMEOUT),
        (GraphRecursionError("secret"), FailureCode.UNKNOWN),
        (httpx.ConnectError("secret"), FailureCode.MODEL),
        (EmptyReplyError("secret"), FailureCode.EMPTY),
        (asyncio.CancelledError(), FailureCode.INTERRUPTED),
        (RuntimeError("timeout budget connection secret"), FailureCode.UNKNOWN),
    ],
)
def test_failure_category_uses_exception_type(error, code):
    assert classify_failure(error) == code


def test_error_catalog_defaults_and_status_validation():
    assert set(CATALOG) == set(ErrorCode)
    for code, definition in CATALOG.items():
        error = ApiError(definition.status, code)
        assert error.detail == definition.message
        with pytest.raises(ValueError, match="status"):
            ApiError(200, code)


@pytest.mark.parametrize("version", [-1, True, 1.2, "1"])
def test_version_is_a_nonnegative_json_integer(version):
    with pytest.raises(ValidationError):
        TurnInput(request_id=uuid4(), version=version)


def test_request_defaults_and_text_are_preserved():
    request = TurnInput(request_id=uuid4(), version=0, text="  内容  ")
    assert request.text == "  内容  "
    assert request.action == "speak" and request.npc == "sun"
    assert DevLogin(name=" 玩家 ").name == "玩家"
    with pytest.raises(ValidationError):
        DevLogin(name=" \t ")
    with pytest.raises(ValidationError):
        TurnInput.model_validate({**request.model_dump(), "typo": True})


def test_legacy_failure_is_normalized_without_rewriting_input():
    raw = {
        "turn_id": str(uuid4()),
        "status": "failed",
        "text": "旧文案",
        "save": {
            "id": str(uuid4()),
            "version": 1,
            "state": initial_state().model_dump(),
        },
    }
    result = TurnResult.model_validate(raw)
    assert result.failure.code == FailureCode.UNKNOWN
    assert "已保存的行动仍然有效" in result.failure.message
    assert result.text == "旧文案"
    assert "failure" not in raw and "retryable" not in raw
    with pytest.raises(ValidationError):
        TurnResult.model_validate({**raw, "status": "completed", "failure": result.failure})


@pytest.mark.parametrize(
    "path", ["/api/auth/dev", "/api/saves/11111111-1111-4111-8111-111111111111/turns"]
)
def test_invalid_body_encoding_is_safe_client_error(app, path):
    from fastapi.testclient import TestClient

    # No lifespan or database is needed: parsing rejects the body before dependencies run.
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post(
        path,
        content=b'{"name":"private-\xff"}',
        headers={"Content-Type": "application/json", "X-Request-Id": "encoding-test"},
    )
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "request_body_invalid"
    assert error["recovery"] == "edit"
    assert error["message"] == CATALOG[ErrorCode.REQUEST_BODY_INVALID].message
    assert error["request_id"] == response.headers["x-request-id"]
    assert response.headers["cache-control"] == "no-store"
    assert "private" not in response.text
    operation_path = "/api/auth/dev" if path.endswith("dev") else "/api/saves/{save_id}/turns"
    contract = app.openapi()["paths"][operation_path]["post"]["responses"]["400"]
    assert contract["description"] == "request_body_invalid"
