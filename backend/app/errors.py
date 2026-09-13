"""One error shape for every non-2xx response, with one deliberate exception.

FastAPI's default is a bare `{"detail": "<string>"}`: no machine-readable code a
client can branch on, nothing to correlate a player's complaint with a log line,
and an unhandled exception's own text reaching the client through the 500 path.

The exception is `/api/ready`, which answers 503 with its own ReadyOut payload.
A readiness probe exists to say *which* dependency failed; wrapping that in a
generic envelope would leave an orchestrator knowing only "not ready", which is
the one thing it already knew from the status code.
"""

import logging
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request

from .error_catalog import CATALOG, ErrorCode
from .logging_setup import request_id
from .schemas import ErrorBody, ErrorEnvelope, FieldIssue

logger = logging.getLogger("btl.errors")

# Public because the handlers below render them; the contract declarations do not
# quote them. `message` is prose for a human and is free to change, so a
# description that copied one would be a second, weaker promise that stops
# matching the response without anything failing.
INTERNAL_MESSAGE = CATALOG[ErrorCode.INTERNAL_ERROR].message
VALIDATION_MESSAGE = CATALOG[ErrorCode.VALIDATION_FAILED].message

# The published error vocabulary: every code this API returns, keyed by the status
# it arrives under. Load-bearing in both directions. `codes()` below renders the
# route declarations from it and refuses a name that is not here, so the
# application cannot start while documenting a code nothing raises; and
# tests/test_errors.py walks every call site under app/ to fail if this table
# names a code that is never raised.
DERIVED_CODES: tuple[str, ...] = ("http_404", "http_405")
VOCABULARY: dict[int, tuple[str, ...]] = {}
for _code, _definition in CATALOG.items():
    if _code not in DERIVED_CODES:
        VOCABULARY[_definition.status] = (*VOCABULARY.get(_definition.status, ()), _code.value)

# FastAPI documents a validation failure as its own HTTPValidationError `detail`
# array. This API answers with the same envelope as every other error, so the
# committed contract would otherwise advertise a shape the server never sends.
#
# These are applied per route rather than app-wide on purpose. A blanket
# `responses=` on the FastAPI constructor lands on all sixteen routes, including
# the eleven that take no body and no parameters and therefore cannot fail
# validation -- trading one inaccuracy for eleven.
type Responses = dict[int | str, dict[str, Any]]


def codes(status: int, *names: str) -> str:
    """The codes a caller can receive under `status`, as a contract description.

    Checked against VOCABULARY at import time. That is what turns a misspelling,
    or a code added at a raise site without being published, into a refusal to
    start -- rather than a committed contract that quietly stops describing the
    API it documents.
    """
    published = VOCABULARY[status]
    for name in names:
        if name not in published:
            raise ValueError(f"{name!r} is not a published {status} code in errors.VOCABULARY")
    return " / ".join(names)


def envelope_response(description: str, headers: dict[str, Any] | None = None) -> dict[str, Any]:
    """One documented error response, for a route adding its own status."""
    declared: dict[str, Any] = {"model": ErrorEnvelope, "description": description}
    if headers:
        declared["headers"] = headers
    return declared


# Declared as a real response header rather than mentioned in a description: a
# client is expected to act on it, and a generator that reads the contract can
# only surface what the contract states structurally.
_RETRY_AFTER_HEADER: dict[str, Any] = {
    "Retry-After": {
        "description": "整秒数。RFC 9110 数值形式，客户端应据此等待后再重试。",
        "schema": {"type": "integer"},
    }
}

# True of every route: the unhandled-exception handler is installed on the app.
ERROR_RESPONSES: Responses = {500: envelope_response(codes(500, "internal_error"))}

# Adds the session dependency's rejection, for the routes behind `current_user`.
AUTH_RESPONSES: Responses = {
    401: envelope_response(codes(401, "not_authenticated")),
    **ERROR_RESPONSES,
}

# Adds what FastAPI itself documents for a route taking a body or path parameter.
ROUTE_RESPONSES: Responses = {
    422: envelope_response(codes(422, "validation_failed")),
    **AUTH_RESPONSES,
}

# Adds the two rejections the mutation guard in main.py returns before a route
# runs. Both are answered by middleware on every POST, so neither had been
# documented on any route at all.
MUTATION_RESPONSES: Responses = {
    403: envelope_response(codes(403, "forbidden_origin")),
    415: envelope_response(codes(415, "json_required")),
    **ERROR_RESPONSES,
}

# Adds the lookup failure every save-addressed route can answer with. One code
# covers "not yours" and "not there" on purpose; see owned_save in services.py.
SAVE_RESPONSES: Responses = {
    409: envelope_response(codes(409, "unsupported_save_version")),
    **ROUTE_RESPONSES,
    404: envelope_response(codes(404, "save_not_found")),
}

# One tier per route family rather than a shared turn tier: the lookup route
# cannot answer 429 or 503, and declaring them there would repeat, in
# miniature, the over-declaration a blanket app-wide override would cause.
TURN_RESPONSES: Responses = {
    **ROUTE_RESPONSES,
    404: envelope_response(codes(404, "save_not_found", "turn_not_found")),
    409: envelope_response(codes(409, "unsupported_save_version")),
}

# The composed tiers come first so the statuses this route narrows or adds win:
# its 422 covers three codes, not only FastAPI's own.
BODY_RESPONSES: Responses = {
    400: envelope_response(codes(400, "request_body_invalid")),
}

SUBMIT_RESPONSES: Responses = {
    **BODY_RESPONSES,
    **ROUTE_RESPONSES,
    **MUTATION_RESPONSES,
    404: envelope_response(codes(404, "save_not_found")),
    409: envelope_response(codes(409, *VOCABULARY[409])),
    422: envelope_response(codes(422, *VOCABULARY[422])),
    429: envelope_response(codes(429, *VOCABULARY[429]), _RETRY_AFTER_HEADER),
    503: envelope_response(
        codes(503, "model_unconfigured", "monthly_cost_cap_reached"), _RETRY_AFTER_HEADER
    ),
}


class ApiError(HTTPException):
    """An HTTPException that also carries a stable machine-readable code.

    Subclassing rather than replacing HTTPException keeps every existing raise
    site, dependency and FastAPI code path working; only the rendered body
    changes. `code` is a snake_case identifier clients may branch on and must not
    be reworded once shipped; `message` is prose for a human and may change.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        definition = CATALOG[ErrorCode(code)]
        if status_code != definition.status:
            raise ValueError("Error status does not match catalog")
        super().__init__(status_code, message or definition.message, headers)
        self.code = code


@contextmanager
def _correlated(request: Request) -> Iterator[str]:
    """Re-bind the request id for the duration of a handler.

    Handlers run after the middleware that set the ContextVar has unwound, so
    both the log line and the response body are rebuilt from the scope copy.
    """
    stored = request.scope.get("state", {}).get("request_id")
    identifier = stored if isinstance(stored, str) else request_id.get()
    token = request_id.set(identifier)
    try:
        yield identifier
    finally:
        request_id.reset(token)


def error_response(
    status_code: int,
    code: str,
    message: str | None,
    request: Request,
    headers: Mapping[str, str] | None = None,
    details: list[FieldIssue] | None = None,
) -> JSONResponse:
    """Render the envelope without raising.

    For middleware, which Starlette stacks *outside* ExceptionMiddleware: an
    HTTPException raised there finds no handler, unwinds past ServerErrorMiddleware
    and reaches uvicorn as a bare `Internal Server Error`. Returning is the only
    way such a layer can produce the same body a route would.
    """
    with _correlated(request) as identifier:
        # The header is stamped here and not only by RequestIdMiddleware because
        # ServerErrorMiddleware wraps that middleware: a 500 it renders is sent
        # straight to the client and never passes back through the hook that would
        # have added it. Correlation and cache policy cannot be overridden by a caller.
        rendered = {
            **(headers or {}),
            "x-request-id": identifier,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
        }
        public_code = ErrorCode(code)
        logger.info(
            "request_rejected",
            extra={
                "fields": {
                    "code": public_code.value,
                    "status": status_code,
                    "method": request.method,
                    "route": getattr(request.scope.get("route"), "path", "unmatched"),
                }
            },
        )
        wait = rendered.get("Retry-After", "")
        body = ErrorBody(
            code=public_code,
            message=message or CATALOG[public_code].message,
            request_id=identifier,
            recovery=CATALOG[public_code].recovery,
            details=details,
            retry_after_seconds=int(wait) if wait.isdigit() else None,
        )
        return JSONResponse(
            ErrorEnvelope(error=body).model_dump(mode="json", exclude_none=True),
            status_code,
            rendered,
        )


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def on_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # FastAPI's own internals raise plain HTTPException -- 404 on an unknown
        # path, 405 on a bad method -- which carries no code, so a stable one is
        # derived from the status instead.
        if exc.status_code == 400 and not isinstance(exc, ApiError):
            return error_response(400, "request_body_invalid", None, request, exc.headers)
        code = getattr(exc, "code", None) or f"http_{exc.status_code}"
        if code not in ErrorCode:
            return error_response(500, "internal_error", INTERNAL_MESSAGE, request)
        detail = exc.detail
        message = (
            detail
            if isinstance(exc, ApiError) and isinstance(detail, str)
            else CATALOG[ErrorCode(code)].message
        )
        return error_response(exc.status_code, code, message, request, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def on_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Never reflect unknown field names: they are also attacker-controlled input.
        public_fields = {
            "body",
            "path",
            "query",
            "request_id",
            "save_id",
            "version",
            "npc",
            "action",
            "text",
            "name",
            "proposed_action",
            "proposal_id",
            "discussion_id",
            "perspective_id",
            "snapshot_id",
            "story_id",
            "story_version",
            "kind",
            "operation",
            "before",
            "limit",
        }
        messages = {
            "missing": "缺少必填字段。",
            "extra_forbidden": "请求包含不支持的字段。",
            "string_too_long": "文字长度超出限制。",
            "string_too_short": "文字不能为空。",
            "uuid_parsing": "编号格式不正确。",
            "int_type": "必须为整数。",
            "greater_than_equal": "数值低于允许范围。",
            "json_invalid": "JSON 格式不正确。",
        }
        issues = [
            FieldIssue(
                field=".".join(
                    str(part) if str(part) in public_fields else "unknown" for part in error["loc"]
                ),
                code=error["type"],
                message=messages.get(error["type"], "字段格式或内容不正确。"),
            )
            for error in exc.errors()[:20]
        ]
        with _correlated(request):
            logger.warning(
                "validation_failed",
                extra={
                    "fields": {
                        "path": getattr(request.scope.get("route"), "path", "unknown"),
                        "invalid_fields": ",".join(sorted({issue.field for issue in issues})),
                    }
                },
            )
        return error_response(422, "validation_failed", VALIDATION_MESSAGE, request, details=issues)

    @app.exception_handler(Exception)
    async def on_unhandled(request: Request, exc: Exception) -> JSONResponse:
        with _correlated(request):
            # The formatter records only exception type; exception text can contain
            # SQL parameters or OAuth secrets. The response
            # carries a constant string, so no exception text can reach a client.
            # Starlette re-raises after this handler returns, so uvicorn records
            # the failure too -- which is what makes a swallowed 500 impossible.
            logger.exception(
                "unhandled_error",
                extra={"fields": {"path": request.url.path, "method": request.method}},
            )
        return error_response(500, "internal_error", INTERNAL_MESSAGE, request)
