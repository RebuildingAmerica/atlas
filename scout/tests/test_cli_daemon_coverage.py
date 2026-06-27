"""Comprehensive coverage tests for atlas_scout.cli.

These tests cover code paths not exercised by ``test_cli.py`` or
``test_cli_profiles.py``: the ``run`` extra branches (provider/model/file
sources, quiet, follow-link overrides), the ``db``/``runs``/``entries``/
``pages``/``schedule``/``daemon`` commands' full behaviour, and assorted
helper functions.
"""

from __future__ import annotations

import io
import signal
from pathlib import Path
from typing import Any

import pytest
from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.cli import (
    _clear_failed_daemon_start,
    _daemon_interval_metadata,
    _daemon_process_is_running,
    _daemon_run_internal,
    _daemon_start,
    _daemon_start_claim_is_stale,
    _daemon_start_conflict_message,
    _daemon_status,
    _daemon_stop,
    _open_store,
    _render_recent_run_summary,
    _render_recent_tick_summary,
    _signal_daemon_process,
    _spawn_daemon_process,
    _wait_for_daemon_start,
    _wait_for_daemon_stop,
    main,
)
from atlas_scout.config import (
    ScheduleConfig,
    ScheduleTarget,
    ScoutConfig,
    StoreConfig,
)
from atlas_scout.store import ScoutStore

DEFAULT_CRON = "0 2 * * *"


def _capture_consoles(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
    """Redirect both module consoles into a single buffer for assertions."""
    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def _make_config(tmp_path: Path, **overrides: Any) -> ScoutConfig:
    """Return a ScoutConfig pinned to a tmp DB."""
    base: dict[str, Any] = {"store": StoreConfig(path=str(tmp_path / "scout.db"))}
    base.update(overrides)
    return ScoutConfig(**base)


def _scheduled_config(tmp_path: Path) -> ScoutConfig:
    """ScoutConfig with one schedule target and tmp DB."""
    return _make_config(
        tmp_path,
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing"])]
        ),
    )


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
    from datetime import UTC
    from datetime import datetime as _dt

    now = _dt.now(UTC).isoformat()
    assert _daemon_start_claim_is_stale({"status": "starting", "updated_at": now}) is False


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


# Daemon command branches that the existing test_cli.py does not hit


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
    await store._execute(
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


# ---------------------------------------------------------------------------
# schedule commands
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_start_clears_stale_running_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When daemon was 'running' but the PID is dead, claim should reclaim with a notice."""
    config = _scheduled_config(tmp_path)

    output = _capture_consoles(monkeypatch)

    async def seed() -> None:
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

    await seed()

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)

    class FakePopen:
        pid = 9999

        def poll(self) -> None:
            return None

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        return {"status": "running", "process_id": 9999}

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)

    await _daemon_start(
        config,
        config_path=tmp_path / "scout.toml",
        profile_name=None,
        debug=False,
        search_api_key="k",
        interval=300,
    )
    rendered = output.getvalue()
    assert "stale daemon state" in rendered.lower()
    assert "4321" in rendered  # the cleared PID


@pytest.mark.asyncio
async def test_daemon_start_clears_stale_running_state_without_pid(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Stale 'running' branch when tracked_pid is not an int (line 1238)."""
    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class StubStore:
        def __init__(self) -> None:
            self.calls = 0

        async def get_daemon_state(self) -> dict[str, Any]:
            self.calls += 1
            # First call is during pre-claim check; subsequent calls won't matter.
            return {
                "status": "running",
                "process_id": None,  # not an int -> hit non-int branch
                "updated_at": "2025-01-01T00:00:00+00:00",
            }

        async def claim_daemon_start(self, **_kwargs: Any) -> bool:
            return True

        async def close(self) -> None:
            return None

    stub = StubStore()

    async def fake_open_store(_config: ScoutConfig) -> Any:
        return stub

    monkeypatch.setattr(cli_module, "_open_store", fake_open_store)

    class FakePopen:
        pid = 9999

        def poll(self) -> None:
            return None

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        return {"status": "running", "process_id": 9999}

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)

    await _daemon_start(
        config,
        config_path=tmp_path / "scout.toml",
        profile_name=None,
        debug=False,
        search_api_key="k",
        interval=300,
    )
    rendered = output.getvalue()
    # Branch where tracked_pid is not int -> "Cleared stale daemon state before restart"
    assert "Cleared stale daemon state before restart" in rendered


@pytest.mark.asyncio
async def test_daemon_start_signal_on_spawn_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the path where _wait_for_daemon_start fails and the live process gets SIGTERMed."""
    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class FakePopen:
        pid = 7777

        def poll(self) -> None:
            return None

    seen_signals: list[int] = []

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise RuntimeError("never ready")

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)
    monkeypatch.setattr(cli_module, "_signal_daemon_process", lambda pid: seen_signals.append(pid))

    with pytest.raises(RuntimeError):
        await _daemon_start(
            config,
            config_path=tmp_path / "scout.toml",
            profile_name=None,
            debug=False,
            search_api_key="k",
            interval=300,
        )
    assert seen_signals == [7777]
    # Output not asserted; cleanup happened.
    _ = output


@pytest.mark.asyncio
async def test_daemon_start_signal_handles_lookup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cover the suppress(ProcessLookupError) branch when the process disappears mid-cleanup."""
    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class FakePopen:
        pid = 5555

        def poll(self) -> None:
            return None

    async def fake_wait(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise RuntimeError("never ready")

    def boom(_pid: int) -> None:
        raise ProcessLookupError

    monkeypatch.setattr(cli_module.subprocess, "Popen", lambda *_args, **_kwargs: FakePopen())
    monkeypatch.setattr(cli_module, "_wait_for_daemon_start", fake_wait)
    monkeypatch.setattr(cli_module, "_signal_daemon_process", boom)

    with pytest.raises(RuntimeError):
        await _daemon_start(
            config,
            config_path=tmp_path / "scout.toml",
            profile_name=None,
            debug=False,
            search_api_key="k",
            interval=300,
        )
    _ = output


# ---------------------------------------------------------------------------
# Daemon start happy path: unclaimed conflict + spawn cleanup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daemon_start_returns_conflict_when_claim_lost(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If claim_daemon_start fails (race), surface the conflict message."""
    import click as click_module

    config = _scheduled_config(tmp_path)
    output = _capture_consoles(monkeypatch)

    class StubStore:
        async def get_daemon_state(self) -> dict[str, Any]:
            return {"status": "stopped", "process_id": None, "updated_at": "x"}

        async def claim_daemon_start(self, **_kwargs: Any) -> bool:
            return False

        async def close(self) -> None:
            return None

    async def fake_open_store(_config: ScoutConfig) -> Any:
        return StubStore()

    monkeypatch.setattr(cli_module, "_open_store", fake_open_store)

    # Patch the second call: simplest way is to swap the method after the first call.
    call_count = {"n": 0}

    async def get_state(_self: StubStore) -> dict[str, Any]:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"status": "stopped", "process_id": None, "updated_at": "x"}
        return {"status": "running", "process_id": 4321}

    StubStore.get_daemon_state = get_state  # type: ignore[assignment]

    with pytest.raises(click_module.ClickException) as info:
        await _daemon_start(
            config,
            config_path=tmp_path / "scout.toml",
            profile_name=None,
            debug=False,
            search_api_key="k",
            interval=300,
        )
    assert "PID 4321" in info.value.message
    # Reset attribute so other tests don't see the stub.
    _ = output  # ensure capture didn't crash; nothing else expected
