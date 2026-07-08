"""State and metadata helper coverage for atlas_scout.cli daemon behavior."""

from __future__ import annotations

from datetime import UTC
from datetime import datetime as _dt
from typing import TYPE_CHECKING

from atlas_scout.cli import (
    _daemon_interval_metadata,
    _daemon_start_claim_is_stale,
    _daemon_start_conflict_message,
)
from atlas_scout.config import ScheduleConfig

from .daemon_coverage_support import DEFAULT_CRON, _make_config

if TYPE_CHECKING:
    from pathlib import Path


def test_daemon_interval_metadata_with_override(tmp_path: Path) -> None:
    interval, basis = _daemon_interval_metadata(_make_config(tmp_path), interval=300)
    assert interval == 300
    assert "fixed" in basis


def test_daemon_interval_metadata_uses_cron(tmp_path: Path) -> None:
    config = _make_config(tmp_path, schedule=ScheduleConfig(cron=DEFAULT_CRON))
    interval, basis = _daemon_interval_metadata(config, interval=0)
    assert interval > 0
    assert basis == f"cron {DEFAULT_CRON}"


def test_daemon_start_conflict_message_running() -> None:
    msg = _daemon_start_conflict_message({"status": "running", "process_id": 12})
    assert "PID 12" in msg


def test_daemon_start_conflict_message_starting() -> None:
    msg = _daemon_start_conflict_message({"status": "starting", "process_id": None})
    assert "already being started" in msg


def test_daemon_start_conflict_message_other() -> None:
    msg = _daemon_start_conflict_message({"status": "stopped", "process_id": None})
    assert "state changed" in msg


def test_daemon_start_claim_is_stale_not_starting() -> None:
    assert _daemon_start_claim_is_stale({"status": "running"}) is False


def test_daemon_start_claim_is_stale_missing_updated_at() -> None:
    assert _daemon_start_claim_is_stale({"status": "starting"}) is False


def test_daemon_start_claim_is_stale_invalid_timestamp() -> None:
    assert _daemon_start_claim_is_stale({"status": "starting", "updated_at": "not-a-date"}) is False


def test_daemon_start_claim_is_stale_naive_timestamp_is_stale() -> None:
    """A naive timestamp far in the past should still be considered stale."""
    assert (
        _daemon_start_claim_is_stale(
            {"status": "starting", "updated_at": "2000-01-01T00:00:00"},
        )
        is True
    )


def test_daemon_start_claim_is_stale_recent_is_not_stale() -> None:
    now = _dt.now(UTC).isoformat()
    assert _daemon_start_claim_is_stale({"status": "starting", "updated_at": now}) is False
