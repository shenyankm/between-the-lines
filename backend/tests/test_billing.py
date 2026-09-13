"""The billing window's arithmetic, which is what a Retry-After promise is made of.

The cost cap answers 503 with a Retry-After counting down to the next UTC month. A
client that trusts that header is waiting on this arithmetic, so the month rollover
is checked directly rather than observed through a response.

Unit-marked: pure datetime functions, no database and no network.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.services import _seconds_until_next_utc_month, _start_of_utc_month

pytestmark = pytest.mark.unit


def test_the_window_starts_on_the_first_instant_of_the_utc_month():
    now = datetime(2026, 9, 12, 20, 31, 45, 123456, tzinfo=UTC)
    assert _start_of_utc_month(now) == datetime(2026, 9, 1, tzinfo=UTC)


def test_the_wait_is_exactly_the_distance_to_the_next_month():
    # 18 days and 4 hours from 2026-09-12T20:00Z to 2026-10-01T00:00Z. Spelled out
    # rather than recomputed the same way the implementation does it: a test that
    # mirrored the code would agree with it about a wrong answer.
    assert (
        _seconds_until_next_utc_month(datetime(2026, 9, 12, 20, tzinfo=UTC))
        == 18 * 86400 + 4 * 3600
    )


def test_december_rolls_the_year_over_and_not_into_a_thirteenth_month():
    # datetime.replace(month=13) raises, so a naive `now.month + 1` would fail on
    # the one night of the year a cap is most likely to be hit: New Year's Eve.
    assert _seconds_until_next_utc_month(datetime(2026, 12, 31, 23, tzinfo=UTC)) == 3600


@pytest.mark.parametrize("month", range(1, 13))
def test_every_month_lands_on_the_first_instant_of_the_one_after_it(month):
    now = datetime(2026, month, 15, 12, tzinfo=UTC)
    wait = _seconds_until_next_utc_month(now)
    # Positive, and landing exactly on a month boundary: the property a client
    # depends on, checked for every month rather than the two tested above.
    assert wait > 0
    assert now + timedelta(seconds=wait) == _start_of_utc_month(now).replace(
        year=2026 + (month == 12), month=1 if month == 12 else month + 1
    )


def test_a_short_month_is_not_overestimated():
    # February 2026 has 28 days. Hardcoding 30 would leave the cap silently
    # telling clients to wait two days longer than they need to.
    assert _seconds_until_next_utc_month(datetime(2026, 2, 1, tzinfo=UTC)) == 28 * 86400
