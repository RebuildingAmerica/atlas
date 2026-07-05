"""Scout CLI interrupt behavior tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import click
import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main

if TYPE_CHECKING:
    from collections.abc import Coroutine
    from pathlib import Path
    from typing import Any


def test_async_command_callbacks_use_shared_interrupt_runner(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Async command callbacks should share one Ctrl-C boundary."""
    called: list[bool] = []

    async def list_runs(_config: object, _limit: int) -> None:
        return None

    def run_async(coro: Coroutine[Any, Any, None]) -> None:
        called.append(True)
        coro.close()

    monkeypatch.setattr(cli_module, "_runs_list", list_runs)
    monkeypatch.setattr(cli_module, "_run_async", run_async, raising=False)

    result = CliRunner().invoke(
        main,
        ["--config", str(tmp_path / "scout.toml"), "runs", "list"],
    )

    assert result.exit_code == 0, result.output
    assert called == [True]


def test_async_interrupts_abort_without_traceback() -> None:
    """Keyboard interrupts in async commands should surface as a clean CLI abort."""

    async def interrupted() -> None:
        raise KeyboardInterrupt

    run_async = getattr(cli_module, "_run_async", None)
    assert run_async is not None

    with pytest.raises(click.Abort):
        run_async(interrupted())


def test_interrupted_async_command_renders_clean_abort(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Actual command output should be terse when Ctrl-C stops async work."""

    async def list_runs(_config: object, _limit: int) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(cli_module, "_runs_list", list_runs)

    result = CliRunner().invoke(
        main,
        ["--config", str(tmp_path / "scout.toml"), "runs", "list"],
    )

    assert result.exit_code != 0
    assert "Aborted!" in result.output
    assert "Traceback" not in result.output
