"""Per-generation milestones, containing numbers only (never prompts or headers)."""

import time
from contextvars import ContextVar
from dataclasses import dataclass, field


@dataclass
class ModelTiming:
    started: float = field(default_factory=time.monotonic)
    values: dict[str, int] = field(default_factory=dict)

    def mark(self, name: str) -> None:
        self.values.setdefault(name, round((time.monotonic() - self.started) * 1000))

    def request(self, size: int) -> None:
        self.mark("model_request_ms")
        self.values["model_http_requests"] = self.values.get("model_http_requests", 0) + 1
        self.values["model_request_bytes"] = self.values.get("model_request_bytes", 0) + size


current_timing: ContextVar[ModelTiming | None] = ContextVar("model_timing", default=None)


async def response_headers(_response: object) -> None:
    timing = current_timing.get()
    if timing is not None:
        timing.mark("model_headers_ms")
