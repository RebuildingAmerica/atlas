"""OS process control primitives shared by Scout's daemon and worker.

Kept underscore-prefixed to match the names ``atlas_scout.cli_compat``
already exposes as legacy ``atlas_scout.cli`` monkeypatch targets.
"""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path


def _daemon_process_is_running(process_id: int) -> bool:
    """Return True when the tracked daemon process is still alive."""
    if process_id <= 0:
        return False
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _signal_daemon_process(process_id: int) -> None:
    """Send SIGTERM to the tracked daemon process or process group."""
    if hasattr(os, "killpg"):
        os.killpg(process_id, signal.SIGTERM)
        return
    os.kill(process_id, signal.SIGTERM)


def spawn_detached_scout_process(
    *,
    config_path: Path,
    debug: bool,
    extra_args: Sequence[str],
    env_overrides: dict[str, str] | None = None,
) -> subprocess.Popen[bytes]:
    """Launch a detached ``python -m atlas_scout.cli`` background process."""
    command = [sys.executable, "-m", "atlas_scout.cli", "--config", str(config_path)]
    if debug:
        command.append("--debug")
    command.extend(extra_args)

    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)
    return subprocess.Popen(
        command,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _spawn_daemon_process(
    *,
    config_path: Path,
    debug: bool,
    search_api_key: str,
    interval: int,
) -> subprocess.Popen[bytes]:
    """Launch the hidden daemon runner as a detached local background process."""
    extra_args = ["daemon", "run-internal"]
    if interval > 0:
        extra_args.extend(["--interval", str(interval)])
    return spawn_detached_scout_process(
        config_path=config_path,
        debug=debug,
        extra_args=extra_args,
        env_overrides={"SEARCH_API_KEY": search_api_key},
    )


def _install_daemon_signal_handlers(stop_event: asyncio.Event) -> None:
    """Register signal handlers that ask the daemon loop to shut down cleanly."""
    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        stop_event.set()

    def _request_stop_threadsafe(_sig: int, _frame: object | None) -> None:
        loop.call_soon_threadsafe(stop_event.set)

    for current_signal in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(current_signal, _request_stop)
        except (NotImplementedError, RuntimeError):
            signal.signal(current_signal, _request_stop_threadsafe)
