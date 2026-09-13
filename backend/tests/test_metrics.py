"""The exposition format, checked against the rules Prometheus actually enforces.

Hand-rolled means nothing upstream validates the output, so the invariants are
asserted here instead: buckets must be cumulative, `+Inf` must equal the
observation count, every series needs HELP and TYPE, and the body must end with
a newline. A scraper is unforgiving about all four.
"""

import re

import pytest

from app.metrics import BUCKETS, observe_turn, render, reset

pytestmark = pytest.mark.unit

# A sample line: optional {labels}, then a space, then a number.
SAMPLE = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? -?\d+(\.\d+)?([eE][-+]?\d+)?$")


@pytest.fixture(autouse=True)
def clean() -> None:
    # The series are module globals and a test that leaves them dirty would make
    # the next test's counts depend on ordering -- which pytest-randomly changes.
    reset()


def parse(text: str) -> dict[str, float]:
    """Sample lines keyed by their full name including labels."""
    out: dict[str, float] = {}
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        assert SAMPLE.match(line), f"not a valid exposition line: {line!r}"
        key, _, value = line.rpartition(" ")
        out[key] = float(value)
    return out


def test_render_produces_only_valid_lines_and_ends_with_a_newline():
    observe_turn("completed", 1.5, 2, 0.01)
    text = render(3)
    assert text.endswith("\n")
    assert parse(text)


def test_every_series_declares_help_and_type_before_its_samples():
    # A cleared counter series renders no samples, so without this observation
    # btl_turns_total would have nothing to compare the declaration order against.
    observe_turn("completed", 1.0, 1, 0.0)
    text = render(0)
    for name, kind in [
        ("btl_turns_total", "counter"),
        ("btl_turns_active", "gauge"),
        ("btl_model_calls_total", "counter"),
        ("btl_cost_usd_total", "counter"),
        ("btl_turn_duration_seconds", "histogram"),
    ]:
        assert f"# HELP {name} " in text, name
        assert f"# TYPE {name} {kind}" in text, name
        # HELP and TYPE must precede the samples they describe.
        assert text.index(f"# TYPE {name}") < text.index(f"\n{name}")


def test_buckets_are_cumulative_and_inf_equals_the_count():
    for duration in (0.1, 0.7, 3.0):
        observe_turn("completed", duration, 1, 0.0)
    samples = parse(render(0))

    # 0.1 lands in every bucket; 0.7 in every bucket from 1.0 up; 3.0 from 5.0 up.
    expected = {0.25: 1, 0.5: 1, 1.0: 2, 2.0: 2, 5.0: 3, 10.0: 3, 30.0: 3, 60.0: 3}
    assert expected.keys() == set(BUCKETS)
    previous = 0
    for upper in BUCKETS:
        value = samples[f'btl_turn_duration_seconds_bucket{{le="{upper}"}}']
        assert value == expected[upper]
        # Monotonic: a cumulative histogram that decreased would be rejected, and
        # would make rate() over the bucket meaningless.
        assert value >= previous
        previous = value

    assert samples['btl_turn_duration_seconds_bucket{le="+Inf"}'] == 3
    assert samples["btl_turn_duration_seconds_count"] == 3
    assert samples["btl_turn_duration_seconds_sum"] == pytest.approx(3.8)


def test_an_observation_exactly_on_a_bound_lands_in_that_bucket():
    observe_turn("completed", 1.0, 0, 0.0)
    samples = parse(render(0))
    # le is inclusive, so 1.0 belongs to le="1.0" and not only to the ones above.
    assert samples['btl_turn_duration_seconds_bucket{le="0.5"}'] == 0
    assert samples['btl_turn_duration_seconds_bucket{le="1.0"}'] == 1


def test_outcomes_are_separate_series_and_a_replay_is_not_a_completion():
    observe_turn("completed", 1.0, 2, 0.01)
    observe_turn("failed", 0.5, 1, 0.0)
    observe_turn("replayed", 0.0, 0, 0.0)
    observe_turn("interrupted", 2.0, 1, 0.0)
    samples = parse(render(0))

    assert samples['btl_turns_total{status="completed"}'] == 1
    assert samples['btl_turns_total{status="failed"}'] == 1
    assert samples['btl_turns_total{status="replayed"}'] == 1
    assert samples['btl_turns_total{status="interrupted"}'] == 1
    # A replay does no model work, so it must not move the cost series.
    assert samples["btl_model_calls_total"] == 4
    assert samples["btl_cost_usd_total"] == pytest.approx(0.01)


def test_an_outcome_never_seen_still_renders_without_a_prior_declaration():
    # `status` is a plain string rather than a Literal so a new outcome cannot
    # require editing two modules. This is that claim, tested.
    observe_turn("some_future_outcome", 0.1, 0, 0.0)
    assert 'btl_turns_total{status="some_future_outcome"} 1' in render(0)


def test_negative_inputs_are_clamped_rather_than_decrementing():
    # A counter that could go backwards would break rate(); a negative cost would
    # quietly offset real spend.
    observe_turn("completed", 1.0, -5, -2.0)
    samples = parse(render(0))
    assert samples["btl_model_calls_total"] == 0
    assert samples["btl_cost_usd_total"] == 0.0
    assert samples["btl_turn_duration_seconds_count"] == 1


def test_reset_returns_every_series_to_its_initial_value():
    observe_turn("completed", 9.0, 3, 1.5)
    reset()
    samples = parse(render(0))
    assert samples["btl_model_calls_total"] == 0
    assert samples["btl_cost_usd_total"] == 0.0
    assert samples["btl_turn_duration_seconds_count"] == 0
    assert samples['btl_turn_duration_seconds_bucket{le="+Inf"}'] == 0
    # A cleared counter series renders no samples at all, which is valid: an
    # absent label set means zero, and printing status="" would be worse.
    assert "btl_turns_total{" not in render(0)


def test_the_gauge_reflects_the_argument_not_module_state():
    assert parse(render(0))["btl_turns_active"] == 0
    assert parse(render(7))["btl_turns_active"] == 7
    # And observing turns must not disturb it: it is read from app.state.runtime.runner.active.
    observe_turn("completed", 1.0, 1, 0.0)
    assert parse(render(7))["btl_turns_active"] == 7


def test_a_label_value_cannot_break_out_of_its_quoted_string():
    # The status comes from this process, not from a client, but a quote or a
    # backslash in it would corrupt the line for every scraper reading it.
    observe_turn('bad"status', 1.0, 0, 0.0)
    line = next(x for x in render(0).splitlines() if x.startswith("btl_turns_total{"))
    assert SAMPLE.match(line), line
