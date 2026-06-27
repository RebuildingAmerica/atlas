"""Tests for small Scout scheduler helpers."""

from __future__ import annotations

import asyncio

import pytest

from atlas_scout.scheduler import (
    _completed_tick_summary,
    _cron_to_interval,
    _stop_requested,
    _wait_for_next_tick,
)


def test_cron_to_interval_parses_minute_step() -> None:
    assert _cron_to_interval("*/30 * * * *") == 1800


def test_cron_to_interval_parses_hour_step() -> None:
    assert _cron_to_interval("0 */6 * * *") == 21600


def test_cron_to_interval_short_expression_falls_back_to_daily() -> None:
    assert _cron_to_interval("0 2") == 86400


def test_cron_to_interval_with_invalid_minute_step_falls_back_to_daily() -> None:
    assert _cron_to_interval("*/abc * * * *") == 86400


def test_cron_to_interval_with_invalid_hour_step_falls_back_to_daily() -> None:
    assert _cron_to_interval("0 */xyz * * *") == 86400


def test_cron_to_interval_unrecognized_pattern_falls_back_to_daily() -> None:
    assert _cron_to_interval("0 2 * * *") == 86400


# ---------------------------------------------------------------------------
# _stop_requested
# ---------------------------------------------------------------------------


def test_stop_requested_returns_false_when_no_event() -> None:
    assert _stop_requested(None) is False


def test_stop_requested_returns_false_when_event_unset() -> None:
    assert _stop_requested(asyncio.Event()) is False


def test_stop_requested_returns_true_when_event_set() -> None:
    event = asyncio.Event()
    event.set()
    assert _stop_requested(event) is True


# ---------------------------------------------------------------------------
# _wait_for_next_tick
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wait_for_next_tick_without_stop_event_sleeps_and_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("atlas_scout.scheduler.asyncio.sleep", fake_sleep)

    stopped = await _wait_for_next_tick(7, None)

    assert stopped is False
    assert sleeps == [7]


@pytest.mark.asyncio
async def test_wait_for_next_tick_returns_false_on_timeout() -> None:
    stop_event = asyncio.Event()  # never set
    stopped = await _wait_for_next_tick(0, stop_event)
    assert stopped is False


@pytest.mark.asyncio
async def test_wait_for_next_tick_returns_true_when_stop_event_set() -> None:
    stop_event = asyncio.Event()
    stop_event.set()
    stopped = await _wait_for_next_tick(60, stop_event)
    assert stopped is True


# ---------------------------------------------------------------------------
# _completed_tick_summary
# ---------------------------------------------------------------------------


def test_completed_tick_summary_singular() -> None:
    assert _completed_tick_summary(1) == "1 scheduled run completed"


def test_completed_tick_summary_plural() -> None:
    assert _completed_tick_summary(0) == "0 scheduled runs completed"
