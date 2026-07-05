"""Scout worker command tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main
from atlas_scout.config import ScoutConfig

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


def test_worker_stop_clears_stale_state_metadata(tmp_path: Path, monkeypatch) -> None:
    """worker stop removes stale live fields when the tracked process is gone."""
    state_path = tmp_path / "worker.json"
    state_path.write_text(
        """
{
  "atlas_url": "https://atlas.example",
  "current_job_id": "job-123",
  "last_completed_job_id": "job-122",
  "last_error": "previous failure",
  "last_heartbeat_at": "2026-07-04T21:33:16.687443+00:00",
  "mode": "starting",
  "process_id": 94108,
  "search_key_configured": true,
  "started_at": "2026-07-04T21:33:16.687348+00:00",
  "status": "running",
  "worker_id": "worker-123",
  "worker_name": "Scout Laptop"
}
""".strip()
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(cli_module, "WORKER_STATE_PATH", state_path)
    monkeypatch.setattr(cli_module, "_daemon_process_is_running", lambda _pid: False)

    result = CliRunner().invoke(main, ["worker", "stop"])

    assert result.exit_code == 0
    assert "not running" in result.output
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["status"] == "stopped"
    assert state["mode"] == "stopped"
    assert state["process_id"] is None
    assert state["atlas_url"] is None
    assert state["worker_id"] is None
    assert state["worker_name"] is None
    assert state["search_key_configured"] is False
    assert state["current_job_id"] is None
    assert state["last_completed_job_id"] is None
    assert state["last_error"] is None
    assert state["last_heartbeat_at"] is None
    assert state["started_at"] is None


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


def test_worker_start_refuses_non_local_model_provider(monkeypatch) -> None:
    """Public worker mode does not launch with paid remote model providers."""
    config = ScoutConfig()
    config.llm.provider = "anthropic"
    monkeypatch.setattr(cli_module, "load_config", lambda _path: config)
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

    result = CliRunner().invoke(main, ["worker", "start"])

    assert result.exit_code != 0
    assert "local model provider" in result.output


@pytest.mark.asyncio
async def test_worker_claim_reports_search_capability(monkeypatch) -> None:
    """Worker claims include whether this host can perform search-backed jobs."""
    captured: dict[str, object] = {}

    async def post(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"job": None}

    monkeypatch.setattr(cli_module, "_worker_post", post)

    job = await cli_module._worker_claim_job(
        atlas_url="https://atlas.example",
        token="api-token",
        worker_id="worker-123",
        lease_seconds=120,
        search_key_configured=False,
    )

    assert job is None
    assert captured["path"] == "/api/discovery-runs/jobs/claim"
    assert captured["payload"] == {
        "lease_seconds": 120,
        "search_key_configured": False,
        "worker_id": "worker-123",
    }


@pytest.mark.asyncio
async def test_worker_fail_reports_retry_metadata(monkeypatch) -> None:
    """Worker failure reporting sends retryability to Atlas."""
    captured: dict[str, object] = {}

    async def post(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {}

    monkeypatch.setattr(cli_module, "_worker_post", post)

    await cli_module._worker_fail_job(
        atlas_url="https://atlas.example",
        token="api-token",
        worker_id="worker-123",
        job_id="job-123",
        error_message="Search provider timed out",
        retryable=True,
    )

    assert captured["path"] == "/api/discovery-runs/jobs/job-123/fail"
    assert captured["payload"] == {
        "error_message": "Search provider timed out",
        "retryable": True,
        "worker_id": "worker-123",
    }


@pytest.mark.asyncio
async def test_worker_processes_direct_url_job_without_search_key(
    tmp_path: Path, monkeypatch
) -> None:
    """Direct URL jobs run as seeded local work and sync into the queued Atlas run."""
    session = ScoutSession(
        atlas_url="https://atlas.example",
        access_token="device-session-token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="user@example.org",
        worker_name="Scout Laptop",
        default_upload_target="public",
        workspace_id=None,
    )
    job = {
        "execution_mode": "direct_url",
        "id": "job-123",
        "input_payload": {"direct_urls": ["https://example.test/seed"]},
        "issue_areas": ["housing_affordability"],
        "location_query": "Austin, TX",
        "run_id": "run-123",
    }
    captured: dict[str, object] = {}

    async def heartbeat(**kwargs: object) -> None:
        captured["heartbeat"] = kwargs

    async def complete(**kwargs: object) -> None:
        captured["complete"] = kwargs

    async def api_token(**kwargs: object) -> str:
        captured["api_token"] = kwargs
        return "fresh-token"

    async def run_pipeline(**kwargs: object) -> None:
        captured["pipeline"] = kwargs

    monkeypatch.setattr(cli_module, "WORKER_STATE_PATH", tmp_path / "worker.json")
    monkeypatch.setattr(cli_module, "_worker_heartbeat_job", heartbeat)
    monkeypatch.setattr(cli_module, "_worker_complete_job", complete)
    monkeypatch.setattr(cli_module, "_worker_api_token", api_token)
    monkeypatch.setattr(cli_module, "_run_pipeline", run_pipeline)

    await cli_module._worker_process_job(
        ScoutConfig(),
        atlas_url="https://atlas.example",
        session=session,
        token="claim-token",
        job=job,
        search_api_key="",
        lease_seconds=120,
    )

    assert captured["pipeline"] == {
        "config": ScoutConfig(),
        "depth": "standard",
        "direct_urls": ["https://example.test/seed"],
        "issues": ["housing_affordability"],
        "location": "Austin, TX",
        "quiet": True,
        "search_api_key": "",
        "sync_after_run": True,
        "sync_remote_run_id": "run-123",
    }
    assert captured["complete"] == {
        "atlas_url": "https://atlas.example",
        "job_id": "job-123",
        "token": "fresh-token",
        "worker_id": "worker-123",
    }
