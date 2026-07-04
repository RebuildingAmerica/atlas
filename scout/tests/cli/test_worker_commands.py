"""Scout worker command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main

if TYPE_CHECKING:
    from pathlib import Path


def test_worker_status_reads_local_state(tmp_path: Path, monkeypatch) -> None:
    """worker status shows the tracked worker state file."""
    state_path = tmp_path / "worker.json"
    state_path.write_text(
        """
{
  "atlas_url": "https://atlas.example",
  "mode": "idle",
  "process_id": 12345,
  "search_key_configured": true,
  "status": "running",
  "worker_name": "Scout Laptop"
}
""".strip()
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(cli_module, "WORKER_STATE_PATH", state_path)
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: True)

    result = CliRunner().invoke(main, ["worker", "status"])

    assert result.exit_code == 0
    assert "Scout worker" in result.output
    assert "Scout Laptop" in result.output
    assert "Search key: yes" in result.output


def test_worker_start_requires_login(monkeypatch) -> None:
    """worker start fails clearly before Scout has a browser-approved session."""
    monkeypatch.setattr(cli_module, "load_session", lambda: None)

    result = CliRunner().invoke(main, ["worker", "start"])

    assert result.exit_code != 0
    assert "Log in with `scout login`" in result.output


def test_worker_start_spawns_background_process(tmp_path: Path, monkeypatch) -> None:
    """worker start launches the hidden run-internal command."""
    state_path = tmp_path / "worker.json"
    captured: dict[str, object] = {}

    class Process:
        pid = 12345

    def spawn(**kwargs: object) -> Process:
        captured.update(kwargs)
        return Process()

    monkeypatch.setattr(cli_module, "WORKER_STATE_PATH", state_path)
    monkeypatch.setattr(cli_module, "_spawn_worker_process", spawn)
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _key=None: "search-key")
    monkeypatch.setattr(
        cli_module,
        "load_session",
        lambda: ScoutSession(
            atlas_url="https://atlas.example",
            access_token="device-session-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
            worker_name="Scout Laptop",
            default_upload_target="workspace",
            workspace_id="org-123",
        ),
    )

    result = CliRunner().invoke(main, ["worker", "start", "--interval", "5"])

    assert result.exit_code == 0
    assert captured["interval"] == 5
    assert captured["search_api_key"] == "search-key"
    assert "Worker started" in result.output
