"""Structured logging and request correlation, on the standard library only.

The project installs with --require-hashes, so every added Python dependency
costs a `uv lock` + `uv export` + CI hash-diff cycle, and the application has
four logging call sites. structlog would be the worst value-per-byte trade in
the repository. Recorded as ADR 005.
"""

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings

# A ContextVar rather than threading.local: a turn's work crosses awaits and runs
# inside tasks that threading.local would not follow.
request_id: contextvars.ContextVar[str] = contextvars.ContextVar("btl_request_id", default="-")

# A caller-supplied X-Request-Id lands verbatim in every log line for that
# request. Restricting the alphabet is what stops it becoming a log-injection
# vector: no newlines, no control characters, no quoted JSON delimiters.
_ACCEPTED_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")

_TEXT_FORMAT = "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"

# uvicorn installs its own handlers and disables propagation before it imports
# the application, so its startup and access lines would bypass this module
# entirely. Taking those loggers over is what makes
# `docker compose logs api | jq -e .` parse every line, not just our own.
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # LogRecord declares no request_id, and %-style formatting resolves names
        # out of the record's attribute dict -- which is what writing to it here
        # feeds. Going through __dict__ rather than `record.request_id = ...` keeps
        # mypy from having to suppress an attribute the stdlib type does not have.
        record.__dict__["request_id"] = request_id.get()
        return True


def _extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    """Read the optional `extra={"fields": {...}}` a call site may attach.

    A payload JSON-encoded into a string inside a JSON `message` is only readable
    by something that knows to decode it twice. Real keys are readable by `jq`
    directly, which is the whole point of emitting JSON.
    """
    fields = getattr(record, "fields", None)
    return fields if isinstance(fields, dict) else {}


class JsonFormatter(logging.Formatter):
    """One JSON object per line, so a log pipeline needs no parser of its own."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        for key, value in _extra_fields(record).items():
            # setdefault, not assignment: a field may not overwrite the envelope
            # keys above, or a call site could forge a level or a timestamp.
            payload.setdefault(key, value)
        if record.exc_info:
            # Tracebacks belong in the log and must never reach a 500 response;
            # app/errors.py is what keeps them apart.
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """The human-readable counterpart, carrying the same fields as key=value."""

    def __init__(self) -> None:
        super().__init__(_TEXT_FORMAT)

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        fields = _extra_fields(record)
        if not fields:
            return line
        return line + " " + " ".join(f"{key}={value}" for key, value in fields.items())


def configure_logging(settings: Settings) -> None:
    """Install one handler on the root logger. Safe to call more than once."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_format == "json" else TextFormatter())
    handler.addFilter(_RequestIdFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(settings.log_level)
    for name in _UVICORN_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True


class RequestIdMiddleware:
    """Assign a correlation id to every HTTP request and echo it back.

    Written as plain ASGI on purpose. `@app.middleware("http")` would add a
    second BaseHTTPMiddleware around the turn endpoint, which streams SSE; there
    is no reason to take that risk for something that only touches headers and a
    ContextVar.

    The id is published in two places, and both are needed. The ContextVar is
    what logging reads, because a log call site has no access to the request. The
    scope state is what the exception handlers read: Starlette installs the
    generic Exception handler on ServerErrorMiddleware, which wraps every user
    middleware, so the `finally` below has already reset the ContextVar by the
    time a 500 handler runs. Without the scope copy, the one response that most
    needs a correlation id is the one that would lose it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        supplied = Headers(scope=scope).get("x-request-id", "")
        identifier = supplied if _ACCEPTED_ID.fullmatch(supplied) else uuid4().hex
        state = scope.setdefault("state", {})
        state["request_id"] = identifier
        token = request_id.set(identifier)

        async def send_with_identifier(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # errors.error_response stamps the id itself, because a 500 rendered
                # by ServerErrorMiddleware is sent from outside this middleware and
                # never reaches here. Appending unconditionally would make every
                # error response carry the header twice, which httpx then joins with
                # a comma -- so the id a client reads back would be "x, x".
                if "x-request-id" not in headers:
                    headers["x-request-id"] = identifier
            await send(message)

        try:
            await self.app(scope, receive, send_with_identifier)
        finally:
            request_id.reset(token)
