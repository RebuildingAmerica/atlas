"""Atlas Scout CLI daemon-stop and status tests."""

from __future__ import annotations

import asyncio
import io
import signal
from unittest.mock import patch

import pytest
from click.testing import CliRunner
from rich.console import Console

from atlas_scout.cli import main


@pytest.mark.asyncio
async def test_daemon_stop_terminates_tracked_process_and_updates_state(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )
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

    seen_signals: list[int] = []
    running_checks = iter([True, False])

    monkeypatch.setattr(
        cli_module,
        "_daemon_process_is_running",
        lambda _pid: next(running_checks),
    )
    monkeypatch.setattr(
        cli_module,
        "_signal_daemon_process",
        lambda pid: seen_signals.append(pid),
    )

    await cli_module._daemon_stop(config)

    store = ScoutStore(config.store.path)
    await store.initialize()
    daemon_state = await store.get_daemon_state()
    await store.close()

    assert seen_signals == [4321]
    assert daemon_state["status"] == "stopped"
    assert daemon_state["process_id"] is None
    assert "Daemon stopped" in output.getvalue()


@pytest.mark.asyncio
async def test_daemon_stop_reconciles_state_when_process_exits_before_signal(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )
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

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)
    monkeypatch.setattr(
        cli_module,
        "_signal_daemon_process",
        lambda _pid: (_ for _ in ()).throw(ProcessLookupError()),
    )

    await cli_module._daemon_stop(config)

    store = ScoutStore(config.store.path)
    await store.initialize()
    daemon_state = await store.get_daemon_state()
    await store.close()

    assert daemon_state["status"] == "stopped"
    assert daemon_state["process_id"] is None
    assert "exited before stop signal" in output.getvalue()


def test_cli_daemon_stop_reports_permission_error(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    async def seed_state() -> None:
        store = ScoutStore(str(tmp_path / "scout.db"))
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

    asyncio.run(seed_state())

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])]
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )

    with (
        patch("atlas_scout.cli.load_config", return_value=config),
        patch("atlas_scout.cli._daemon_process_is_running", return_value=True),
        patch(
            "atlas_scout.cli._signal_daemon_process",
            side_effect=PermissionError("operation not permitted"),
        ),
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "stop",
            ],
        )

    assert result.exit_code != 0
    rendered = output.getvalue().lower()
    assert "permission" in rendered
    assert "4321" in rendered


def test_install_daemon_signal_handlers_uses_threadsafe_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import atlas_scout.cli as cli_module

    class FakeLoop:
        def __init__(self) -> None:
            self.scheduled_callbacks: list[tuple[object, tuple[object, ...]]] = []

        def add_signal_handler(self, _signal_number: signal.Signals, _callback: object) -> None:
            raise NotImplementedError

        def call_soon_threadsafe(self, callback: object, *args: object) -> None:
            self.scheduled_callbacks.append((callback, args))

    class FakeEvent:
        def __init__(self) -> None:
            self.set_calls = 0

        def set(self) -> None:
            self.set_calls += 1

    registered_handlers: dict[signal.Signals, object] = {}
    loop = FakeLoop()
    stop_event = FakeEvent()

    monkeypatch.setattr(cli_module.asyncio, "get_running_loop", lambda: loop)
    monkeypatch.setattr(
        cli_module.signal,
        "signal",
        lambda current_signal, handler: registered_handlers.__setitem__(current_signal, handler),
    )

    cli_module._install_daemon_signal_handlers(stop_event)

    assert set(registered_handlers) == {signal.SIGTERM, signal.SIGINT}

    handler = registered_handlers[signal.SIGTERM]
    assert callable(handler)
    handler(signal.SIGTERM, None)

    assert stop_event.set_calls == 0
    assert loop.scheduled_callbacks == [(stop_event.set, ())]


@pytest.mark.asyncio
async def test_daemon_status_prints_runtime_and_recent_run_summary(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None),
    )

    config = ScoutConfig(
        schedule=ScheduleConfig(
            cron="0 */6 * * *",
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing_affordability"])],
        ),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )
    store = ScoutStore(config.store.path)
    await store.initialize()
    await store.start_daemon(
        config_path=str(tmp_path / "scout.toml"),
        profile_name="default",
        target_count=1,
        process_id=4321,
        interval_seconds=21600,
        interval_basis="cron 0 */6 * * *",
    )
    run_id = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    await store.complete_run(
        run_id,
        queries=4,
        pages_fetched=12,
        entries_found=5,
        entries_after_dedup=4,
    )
    await store.record_daemon_tick_result(
        status="completed",
        run_count=1,
        summary="1 scheduled run completed",
    )
    await store.close()

    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)

    await cli_module._daemon_status(config)

    rendered = output.getvalue()
    assert "running" in rendered.lower()
    assert "4321" in rendered
    assert "cron 0 */6 * * *" in rendered
    assert "1 scheduled run completed" in rendered
    assert run_id in rendered
