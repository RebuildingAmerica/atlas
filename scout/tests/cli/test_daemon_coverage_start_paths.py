"""Daemon start lifecycle coverage for atlas_scout.cli."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

import atlas_scout.cli as cli_module
from atlas_scout.cli import _daemon_start
from atlas_scout.store import ScoutStore

from .daemon_coverage_support import _capture_consoles, _scheduled_config

if TYPE_CHECKING:
    from pathlib import Path

    from atlas_scout.config import ScoutConfig


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
