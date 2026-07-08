"""Atlas Scout CLI daemon-start tests."""

from __future__ import annotations

import asyncio
import io
import sys
from unittest.mock import patch

import pytest
from click.testing import CliRunner
from rich.console import Console

from atlas_scout.cli import main


def test_cli_daemon_start_refuses_duplicate_active_daemon(
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
            interval_seconds=86400,
            interval_basis="cron 0 2 * * *",
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
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
            ],
        )

    assert result.exit_code != 0
    rendered = output.getvalue()
    assert "already running" in rendered.lower()
    assert "4321" in rendered


def test_cli_daemon_start_launches_internal_runner_with_search_key(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig

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

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    async def fake_wait_for_start(*_args, **_kwargs):
        return {
            "status": "running",
            "process_id": 4321,
        }

    with (
        patch("atlas_scout.cli.load_config", return_value=config),
        patch("atlas_scout.cli._daemon_process_is_running", return_value=False),
        patch("atlas_scout.cli.subprocess.Popen", return_value=FakePopen()) as popen,
        patch("atlas_scout.cli._wait_for_daemon_start", side_effect=fake_wait_for_start),
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
                "--interval",
                "300",
            ],
        )

    assert result.exit_code == 0
    command = popen.call_args.args[0]
    env = popen.call_args.kwargs["env"]
    assert command[:3] == [sys.executable, "-m", "atlas_scout.cli"]
    assert command[-4:] == ["daemon", "run-internal", "--interval", "300"]
    assert env["SEARCH_API_KEY"] == "test-key"
    assert "Daemon started" in output.getvalue()


def test_cli_daemon_start_refuses_duplicate_start_in_progress(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    async def seed_state() -> None:
        store = ScoutStore(str(tmp_path / "scout.db"))
        await store.initialize()
        await store.claim_daemon_start(
            config_path=str(tmp_path / "scout.toml"),
            profile_name=None,
            target_count=1,
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
        patch("atlas_scout.cli.subprocess.Popen") as popen,
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
            ],
        )

    assert result.exit_code != 0
    assert not popen.called
    assert "already being started" in output.getvalue().lower()


def test_cli_daemon_start_reclaims_stale_starting_claim(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

    async def seed_state() -> None:
        store = ScoutStore(str(tmp_path / "scout.db"))
        await store.initialize()
        await store.claim_daemon_start(
            config_path=str(tmp_path / "scout.toml"),
            profile_name=None,
            target_count=1,
            interval_seconds=300,
            interval_basis="fixed 300s override",
        )
        await store._db.execute(
            "UPDATE daemon_state SET updated_at = '2000-01-01T00:00:00+00:00' WHERE key = ?",
            ("scout",),
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

    class FakePopen:
        pid = 4321

        def poll(self) -> None:
            return None

    async def fake_wait_for_start(*_args, **_kwargs):
        return {"status": "running", "process_id": 4321}

    with (
        patch("atlas_scout.cli.load_config", return_value=config),
        patch("atlas_scout.cli.subprocess.Popen", return_value=FakePopen()) as popen,
        patch("atlas_scout.cli._wait_for_daemon_start", side_effect=fake_wait_for_start),
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
                "--interval",
                "300",
            ],
        )

    assert result.exit_code == 0
    assert popen.called
    assert "stale daemon start state" in output.getvalue().lower()


def test_cli_daemon_start_clears_claim_when_spawn_fails(
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

    with (
        patch("atlas_scout.cli.load_config", return_value=config),
        patch("atlas_scout.cli.subprocess.Popen", side_effect=OSError("spawn failed")),
    ):
        result = CliRunner().invoke(
            main,
            [
                "--config",
                str(tmp_path / "scout.toml"),
                "daemon",
                "start",
                "--search-api-key",
                "test-key",
            ],
        )

    assert result.exit_code != 0

    async def read_state() -> dict[str, object]:
        store = ScoutStore(config.store.path)
        await store.initialize()
        try:
            return await store.get_daemon_state()
        finally:
            await store.close()

    daemon_state = asyncio.run(read_state())
    assert daemon_state["status"] == "stopped"
    assert daemon_state["process_id"] is None


@pytest.mark.asyncio
async def test_clear_failed_daemon_start_preserves_running_daemon(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import atlas_scout.cli as cli_module
    from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
    from atlas_scout.store import ScoutStore

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

    await cli_module._clear_failed_daemon_start(config, expected_pid=4321)

    store = ScoutStore(config.store.path)
    await store.initialize()
    daemon_state = await store.get_daemon_state()
    await store.close()

    assert daemon_state["status"] == "running"
    assert daemon_state["process_id"] == 4321
