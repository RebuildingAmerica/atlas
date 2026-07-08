"""Helper and runtime coverage for atlas_scout.cli daemon internals."""

from __future__ import annotations

import signal
from pathlib import Path
from typing import Any

import pytest

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    _clear_failed_daemon_start,
    _daemon_process_is_running,
    _open_store,
    _render_recent_run_summary,
    _render_recent_tick_summary,
    _signal_daemon_process,
    _spawn_daemon_process,
    _wait_for_daemon_start,
    _wait_for_daemon_stop,
)
from atlas_scout.store import ScoutStore

from .daemon_coverage_support import _make_config, _scheduled_config

# ---------------------------------------------------------------------------
# init / root group
# ---------------------------------------------------------------------------


def test_daemon_process_is_running_handles_pid_zero() -> None:
    assert _daemon_process_is_running(0) is False


def test_daemon_process_is_running_alive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli_module.os, "kill", lambda _pid, _sig: None)
    assert _daemon_process_is_running(123) is True


def test_daemon_process_is_running_lookup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_pid: int, _sig: int) -> None:
        raise ProcessLookupError

    monkeypatch.setattr(cli_module.os, "kill", boom)
    assert _daemon_process_is_running(123) is False


def test_daemon_process_is_running_permission_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_pid: int, _sig: int) -> None:
        raise PermissionError

    monkeypatch.setattr(cli_module.os, "kill", boom)
    assert _daemon_process_is_running(123) is True


def test_signal_daemon_process_uses_killpg(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}
    monkeypatch.setattr(cli_module.os, "killpg", lambda pid, sig: seen.update(pid=pid, sig=sig))
    _signal_daemon_process(4321)
    assert seen == {"pid": 4321, "sig": signal.SIGTERM}


def test_signal_daemon_process_falls_back_to_kill(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(cli_module.os, "killpg", raising=False)
    seen: dict[str, Any] = {}
    monkeypatch.setattr(cli_module.os, "kill", lambda pid, sig: seen.update(pid=pid, sig=sig))
    _signal_daemon_process(4321)
    assert seen == {"pid": 4321, "sig": signal.SIGTERM}


def test_spawn_daemon_process_builds_command(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakePopen:
        pid = 1234

        def __init__(self, command: list[str], **kwargs: Any) -> None:
            captured["command"] = command
            captured["kwargs"] = kwargs

    monkeypatch.setattr(cli_module.subprocess, "Popen", FakePopen)
    process = _spawn_daemon_process(
        config_path=Path("/tmp/scout.toml"),
        debug=True,
        search_api_key="key",
        interval=300,
    )
    assert process.pid == 1234
    command = captured["command"]
    assert "--debug" in command
    assert "--interval" in command
    assert command[-1] == "300"
    assert captured["kwargs"]["env"]["SEARCH_API_KEY"] == "key"


def test_spawn_daemon_process_no_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakePopen:
        pid = 1234

        def __init__(self, command: list[str], **kwargs: Any) -> None:
            captured["command"] = command
            captured["kwargs"] = kwargs

    monkeypatch.setattr(cli_module.subprocess, "Popen", FakePopen)
    _spawn_daemon_process(
        config_path=Path("/tmp/scout.toml"),
        debug=False,
        search_api_key="key",
        interval=0,
    )
    assert "--debug" not in captured["command"]
    assert "--interval" not in captured["command"]


@pytest.mark.asyncio
async def test_wait_for_daemon_start_succeeds(tmp_path: Path) -> None:
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

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    state = await _wait_for_daemon_start(
        config,
        expected_pid=4321,
        process=FakePopen(),  # type: ignore[arg-type]
        timeout_seconds=1.0,
        poll_interval_seconds=0.01,
    )
    assert state["status"] == "running"


@pytest.mark.asyncio
async def test_wait_for_daemon_start_process_dies(tmp_path: Path) -> None:
    """If the spawned process exits before the store reports ready, raise a click error."""
    import click as click_module

    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()

    class FakePopen:
        pid = 4321

        def poll(self) -> int:
            return 1

    with pytest.raises(click_module.ClickException):
        await _wait_for_daemon_start(
            config,
            expected_pid=4321,
            process=FakePopen(),  # type: ignore[arg-type]
            timeout_seconds=0.5,
            poll_interval_seconds=0.01,
        )


@pytest.mark.asyncio
async def test_wait_for_daemon_start_times_out(tmp_path: Path) -> None:
    import click as click_module

    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.close()

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    with pytest.raises(click_module.ClickException):
        await _wait_for_daemon_start(
            config,
            expected_pid=4321,
            process=FakePopen(),  # type: ignore[arg-type]
            timeout_seconds=0.1,
            poll_interval_seconds=0.01,
        )


@pytest.mark.asyncio
async def test_wait_for_daemon_stop_observes_state(tmp_path: Path) -> None:
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
    # Already stopped state when waiter starts.
    await store.stop_daemon()

    state = await _wait_for_daemon_stop(
        store, process_id=4321, timeout_seconds=1.0, poll_interval_seconds=0.01
    )
    assert state["status"] == "stopped"
    await store.close()


@pytest.mark.asyncio
async def test_wait_for_daemon_stop_reconciles_dead_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)
    state = await _wait_for_daemon_stop(
        store, process_id=4321, timeout_seconds=1.0, poll_interval_seconds=0.01
    )
    assert state["status"] == "stopped"
    await store.close()


@pytest.mark.asyncio
async def test_wait_for_daemon_stop_times_out(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import click as click_module

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
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)
    with pytest.raises(click_module.ClickException):
        await _wait_for_daemon_stop(
            store, process_id=4321, timeout_seconds=0.1, poll_interval_seconds=0.01
        )
    await store.close()


def test_render_recent_run_summary_none() -> None:
    assert _render_recent_run_summary(None) == "none recorded"


def test_render_recent_run_summary_full() -> None:
    summary = _render_recent_run_summary(
        {"id": "abc", "location": "Austin, TX", "status": "completed", "entries_found": 7}
    )
    assert "abc" in summary
    assert "completed" in summary
    assert "7 entries" in summary


def test_render_recent_run_summary_handles_non_int_entries() -> None:
    summary = _render_recent_run_summary(
        {"id": "abc", "location": None, "status": None, "entries_found": "bad"}
    )
    assert "0 entries" in summary
    assert "—" in summary


def test_render_recent_tick_summary_missing() -> None:
    assert _render_recent_tick_summary({}) == "none recorded"
    assert _render_recent_tick_summary({"last_tick_summary": "not a dict"}) == "none recorded"


def test_render_recent_tick_summary_with_completion() -> None:
    summary = _render_recent_tick_summary(
        {
            "last_tick_summary": {
                "summary": "1 run completed",
                "completed_at": "2025-01-01T01:02:03+00:00",
            }
        }
    )
    assert "1 run completed" in summary
    assert "2025-01-01T01:02:03" in summary


def test_render_recent_tick_summary_no_completion() -> None:
    assert _render_recent_tick_summary({"last_tick_summary": {"summary": "ok"}}) == "ok"


@pytest.mark.asyncio
async def test_clear_failed_daemon_start_releases_starting_claim(tmp_path: Path) -> None:
    config = _scheduled_config(tmp_path)
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.claim_daemon_start(
        config_path=str(tmp_path / "scout.toml"),
        profile_name=None,
        target_count=1,
        interval_seconds=300,
        interval_basis="fixed 300s override",
    )
    await store.close()

    await _clear_failed_daemon_start(config, expected_pid=None)

    store = ScoutStore(config.store.path)
    await store.initialize()
    state = await store.get_daemon_state()
    await store.close()
    assert state["status"] == "stopped"


@pytest.mark.asyncio
async def test_clear_failed_daemon_start_clears_running_with_dead_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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
    await _clear_failed_daemon_start(config, expected_pid=4321)

    store = ScoutStore(config.store.path)
    await store.initialize()
    state = await store.get_daemon_state()
    await store.close()
    assert state["status"] == "stopped"


@pytest.mark.asyncio
async def test_open_store_returns_initialized_store(tmp_path: Path) -> None:
    config = _make_config(tmp_path)
    store = await _open_store(config)
    tables = await store.list_tables()
    await store.close()
    assert "runs" in tables
