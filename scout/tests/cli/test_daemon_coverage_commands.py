"""CLI command branch coverage for atlas_scout.cli daemon commands."""

from __future__ import annotations

import signal
from typing import TYPE_CHECKING, Any

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    _daemon_run_internal,
    _daemon_status,
    _daemon_stop,
    main,
)
from atlas_scout.store import ScoutStore

from .daemon_coverage_support import _capture_consoles, _make_config, _scheduled_config

if TYPE_CHECKING:
    from pathlib import Path

    from atlas_scout.config import ScoutConfig


def test_daemon_start_requires_targets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "start", "--search-api-key", "k"])
    assert result.exit_code != 0
    assert "schedule targets" in output.getvalue().lower()


def test_daemon_stop_command_when_not_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _scheduled_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "stop"])
    assert result.exit_code == 0
    assert "not running" in output.getvalue().lower()


@pytest.mark.asyncio
async def test_daemon_stop_with_missing_pid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When daemon state has no PID, stop should reconcile."""
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    # Force "running" status with no PID via direct SQL.
    await store._db.execute(
        "INSERT INTO daemon_state (key, status, process_id, target_count, "
        "interval_seconds, interval_basis, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET status = excluded.status, "
        "process_id = excluded.process_id, target_count = excluded.target_count, "
        "interval_seconds = excluded.interval_seconds, "
        "interval_basis = excluded.interval_basis, "
        "updated_at = excluded.updated_at",
        ("scout", "running", None, 1, 300, "x", "2025-01-01T00:00:00+00:00"),
    )
    await store.close()
    await _daemon_stop(config)
    rendered = output.getvalue()
    assert "had no PID" in rendered or "reconciled" in rendered


@pytest.mark.asyncio
async def test_daemon_stop_with_already_dead_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name=None,
        target_count=1,
        process_id=4321,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.close()
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)

    await _daemon_stop(config)
    rendered = output.getvalue()
    assert "already gone" in rendered.lower()


def test_daemon_status_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _scheduled_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "status"])
    assert result.exit_code == 0
    assert "Scout daemon" in output.getvalue()


@pytest.mark.asyncio
async def test_daemon_status_shows_stale_for_dead_pid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the tracked PID is gone, status should render as 'stale'."""
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name="default",
        target_count=2,
        process_id=4321,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.record_daemon_heartbeat()
    await store.close()
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)
    await _daemon_status(config)
    rendered = output.getvalue()
    assert "stale" in rendered
    assert "default" in rendered
    assert "Last heartbeat" in rendered


@pytest.mark.asyncio
async def test_daemon_status_uses_config_targets_when_state_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When state has no target_count, fall back to len(config.schedule.targets)."""
    output = _capture_consoles(monkeypatch)
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()
    await _daemon_status(config)
    rendered = output.getvalue()
    assert "Targets: 1" in rendered


def test_daemon_run_internal_command_requires_targets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = _make_config(tmp_path)
    monkeypatch.setattr(cli_module, "load_config", lambda _p: config)
    output = _capture_consoles(monkeypatch)
    result = CliRunner().invoke(main, ["daemon", "run-internal", "--search-api-key", "k"])
    assert result.exit_code != 0
    assert "schedule targets" in output.getvalue().lower()


@pytest.mark.asyncio
async def test_daemon_run_internal_invokes_loop(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_daemon_run_internal should configure handlers and call run_schedule_loop."""
    captured: dict[str, Any] = {}

    async def fake_run_schedule_loop(
        _config: ScoutConfig,
        api_key: str,
        *,
        interval_seconds: int,
        lifecycle: Any,
        stop_event: Any,
    ) -> None:
        captured["interval"] = interval_seconds
        captured["api_key"] = api_key
        captured["lifecycle"] = lifecycle
        captured["stop_event"] = stop_event

    import atlas_scout.scheduler as scheduler_module

    monkeypatch.setattr(scheduler_module, "run_schedule_loop", fake_run_schedule_loop)
    monkeypatch.setattr(
        cli_module,
        "_install_daemon_signal_handlers",
        lambda _evt: captured.setdefault("installed", True),
    )
    config = _scheduled_config(tmp_path)
    await _daemon_run_internal(
        config,
        config_path=tmp_path / "scout.toml",
        profile_name="profile",
        search_api_key="key",
        interval=42,
    )
    assert captured["interval"] == 42
    assert captured["api_key"] == "key"
    assert captured["installed"] is True


def test_install_daemon_signal_handlers_uses_loop_when_supported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import atlas_scout.cli as mod

    class FakeLoop:
        def __init__(self) -> None:
            self.added: list[tuple[Any, Any]] = []

        def add_signal_handler(self, sig: Any, callback: Any) -> None:
            self.added.append((sig, callback))

        def call_soon_threadsafe(
            self, _callback: Any, *_args: Any
        ) -> None:  # pragma: no cover - unused
            raise AssertionError("threadsafe should not be called when add_signal_handler succeeds")

    class FakeEvent:
        def set(self) -> None:  # pragma: no cover - exercised via callbacks elsewhere
            pass

    loop = FakeLoop()
    monkeypatch.setattr(mod.asyncio, "get_running_loop", lambda: loop)
    mod._install_daemon_signal_handlers(FakeEvent())  # type: ignore[arg-type]
    assert {sig for sig, _ in loop.added} == {signal.SIGTERM, signal.SIGINT}
    # Trigger the registered callback to cover the inner closure.
    loop.added[0][1]()
