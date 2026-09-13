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

from .logging_setup import request_id
from .schemas import ErrorBody, ErrorEnvelope

logger = logging.getLogger("btl.errors")

# Public because the handlers below render them; the contract declarations do not
# quote them. `message` is prose for a human and is free to change, so a
# description that copied one would be a second, weaker promise that stops
# matching the response without anything failing.
GENERIC_MESSAGE = "请求未完成，请稍后重试。"
INTERNAL_MESSAGE = "服务器内部错误，请稍后重试。"
VALIDATION_MESSAGE = "请求格式不正确。"
AUTH_MESSAGE = "请先登录。"

# The published error vocabulary: every code this API returns, keyed by the status
# it arrives under. Load-bearing in both directions. `codes()` below renders the
# route declarations from it and refuses a name that is not here, so the
# application cannot start while documenting a code nothing raises; and
# tests/test_errors.py walks every call site under app/ to fail if this table
# names a code that is never raised.
VOCABULARY: dict[int, tuple[str, ...]] = {
    400: ("oauth_failed",),
    401: ("not_authenticated",),
    403: ("forbidden_origin",),
    404: ("not_found", "save_not_found", "turn_not_found"),
    409: (
        "request_id_reused",
        "turn_still_running",
        "save_busy",
        "version_conflict",
        "unsupported_save_version",
    ),
    415: ("json_required",),
    422: ("validation_failed", "empty_message", "rule_violation"),
    429: ("daily_limit_reached", "concurrency_budget_exhausted"),
    500: ("internal_error",),
    503: ("oauth_not_configured", "model_unconfigured", "monthly_cost_cap_reached"),
}

# Derived in on_http_error from the status of an exception FastAPI raised itself:
# its 404 for an unknown path and its 405 for a wrong method carry no code, so one
# is built from the status. No call site names them, which is why they are listed
# separately rather than left for the call-site walk to guess at inside an f-string.
DERIVED_CODES: tuple[str, ...] = ("http_404", "http_405")

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
# cannot answer 409, 429 or 503, and declaring them there would repeat, in
# miniature, the over-declaration a blanket app-wide override would cause.
TURN_RESPONSES: Responses = {
    **ROUTE_RESPONSES,
    404: envelope_response(codes(404, "save_not_found", "turn_not_found")),
}

# The composed tiers come first so the statuses this route narrows or adds win:
# its 422 covers three codes, not only FastAPI's own.
SUBMIT_RESPONSES: Responses = {
    **ROUTE_RESPONSES,
    **MUTATION_RESPONSES,
    404: envelope_response(codes(404, "save_not_found")),
    409: envelope_response(codes(409, *VOCABULARY[409])),
    422: envelope_response(codes(422, *VOCABULARY[422])),
    429: envelope_response(codes(429, *VOCABULARY[429]), _RETRY_AFTER_HEADER),
    503: envelope_response(codes(503, "model_unconfigured", "monthly_cost_cap_reached")),
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
        message: str,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(status_code, message, headers)
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


def _envelope(code: str, message: str, identifier: str) -> dict[str, object]:
    body = ErrorBody(code=code, message=message, request_id=identifier)
    return ErrorEnvelope(error=body).model_dump()


def error_response(
    status_code: int,
    code: str,
    message: str,
    request: Request,
    headers: Mapping[str, str] | None = None,
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
        # have added it. A caller-supplied header wins, so nothing is overwritten.
        rendered = {"x-request-id": identifier, **(headers or {})}
        return JSONResponse(_envelope(code, message, identifier), status_code, rendered)


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def on_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # FastAPI's own internals raise plain HTTPException -- 404 on an unknown
        # path, 405 on a bad method -- which carries no code, so a stable one is
        # derived from the status instead.
        code = getattr(exc, "code", None) or f"http_{exc.status_code}"
        detail = exc.detail
        message = detail if isinstance(detail, str) and detail else GENERIC_MESSAGE
        return error_response(exc.status_code, code, message, request, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def on_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        with _correlated(request):
            # exc.errors() echoes back the submitted value, which for this API is
            # a player's private message. Field names are safe to log; values are
            # not, and neither belongs in the response.
            invalid = sorted(
                {".".join(str(part) for part in error["loc"]) for error in exc.errors()}
            )
            logger.warning(
                "validation_failed",
                extra={"fields": {"path": request.url.path, "invalid_fields": ",".join(invalid)}},
            )
        return error_response(422, "validation_failed", VALIDATION_MESSAGE, request)

    @app.exception_handler(Exception)
    async def on_unhandled(request: Request, exc: Exception) -> JSONResponse:
        with _correlated(request):
            # The traceback goes to the log and only to the log: the response
            # carries a constant string, so no exception text can reach a client.
            # Starlette re-raises after this handler returns, so uvicorn records
            # the failure too -- which is what makes a swallowed 500 impossible.
            logger.exception(
                "unhandled_error",
                extra={"fields": {"path": request.url.path, "method": request.method}},
            )
        return error_response(500, "internal_error", INTERNAL_MESSAGE, request)
