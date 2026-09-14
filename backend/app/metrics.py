"""Application-scoped Prometheus text metrics.

Counters reset on process restart; durable timing lives in turns. Mutations run
on the single event loop without awaits. Replays have their own counter and do
not contribute execution duration.
"""

from collections.abc import Iterator

BUCKETS: tuple[float, ...] = (0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0)


class Metrics:
    def __init__(self) -> None:
        self._turns_total: dict[str, int] = {}
        self._duration_buckets = [0] * len(BUCKETS)
        self._duration_count = 0
        self._duration_sum = 0.0

    def reset(self) -> None:
        """Return every series to its initial value. Used by tests, not by the app."""
        self._turns_total.clear()
        self._duration_buckets[:] = [0] * len(BUCKETS)
        self._duration_count = 0
        self._duration_sum = 0.0

    def observe_turn(self, status: str, duration_seconds: float) -> None:
        """Record one finished turn.

        `status` is the outcome main.py tracks: completed, failed, interrupted, or
        replayed. Kept as a plain string rather than a Literal so a new outcome cannot
        require editing two modules to appear in the series.
        """
        self._turns_total[status] = self._turns_total.get(status, 0) + 1
        if status == "replayed":
            return
        # Prometheus buckets are cumulative: le="1.0" must count every observation
        # at or below 1.0, not only those in the (0.5, 1.0] band. Incrementing every
        # bucket whose bound is at least the observation is what makes that true, and
        # it also makes +Inf equal the observation count.
        for index, upper in enumerate(BUCKETS):
            if upper >= duration_seconds:
                self._duration_buckets[index] += 1
        self._duration_count += 1
        self._duration_sum += duration_seconds

    def _lines(self, active_turns: int) -> Iterator[str]:
        yield "# HELP btl_turns_total Turns that reached a terminal status."
        yield "# TYPE btl_turns_total counter"
        for status in sorted(self._turns_total):
            yield f'btl_turns_total{{status="{status}"}} {self._turns_total[status]}'
        yield "# HELP btl_turns_active Turns holding a slot in the execution capacity."
        yield "# TYPE btl_turns_active gauge"
        yield f"btl_turns_active {active_turns}"
        yield "# HELP btl_turn_duration_seconds Wall-clock seconds per turn."
        yield "# TYPE btl_turn_duration_seconds histogram"
        for upper, count in zip(BUCKETS, self._duration_buckets, strict=True):
            yield f'btl_turn_duration_seconds_bucket{{le="{upper}"}} {count}'
        yield f'btl_turn_duration_seconds_bucket{{le="+Inf"}} {self._duration_count}'
        yield f"btl_turn_duration_seconds_sum {self._duration_sum:.6f}"
        yield f"btl_turn_duration_seconds_count {self._duration_count}"

    def render(self, active_turns: int) -> str:
        """Render the exposition format. Ends with a newline, as the format requires."""
        return "".join(f"{line}\n" for line in self._lines(active_turns))


_default = Metrics()
reset = _default.reset
observe_turn = _default.observe_turn
render = _default.render
