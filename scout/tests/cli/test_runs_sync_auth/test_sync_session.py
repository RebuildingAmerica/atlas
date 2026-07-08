"""Logged-in sync path for run artifact uploads."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from atlas_scout.auth import ScoutTokenExchange
from atlas_scout.cli import _runs_sync
from atlas_scout.steps.contribute import ContributionResult

from .support import build_config, capture_consoles, seed_run_with_artifacts, workspace_session

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_sync_uses_login_session_api_token_and_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in sync exchanges the device session for an API bearer token."""
    output = capture_consoles(monkeypatch, __import__("atlas_scout.cli", fromlist=["console"]))
    config = build_config(tmp_path)
    run_id = await seed_run_with_artifacts(config)
    seen: dict[str, object] = {}

    monkeypatch.setattr("atlas_scout.cli.load_session", workspace_session)

    class FakeDeviceAuthClient:
        async def exchange_session_for_api_token(
            self,
            atlas_url: str,
            *,
            session_token: str,
            worker_name: str,
            default_upload_target: str,
            worker_id: str | None = None,
            workspace_id: str | None = None,
            search_key_configured: bool = False,
        ) -> ScoutTokenExchange:
            assert atlas_url == "https://atlas.example"
            assert session_token == "device-session-token"
            assert worker_name
            assert default_upload_target == "workspace"
            assert worker_id == "worker-123"
            assert workspace_id == "org-123"
            assert search_key_configured is False
            return ScoutTokenExchange(
                token="api-jwt",
                worker_id="worker-123",
                user_id="user-123",
                user_email="user@example.org",
                workspace_id="org-123",
            )

    monkeypatch.setattr("atlas_scout.cli.DeviceAuthClient", FakeDeviceAuthClient)

    async def fake_sync(
        _artifacts: Any,
        *,
        atlas_url: str,
        api_key: str,
        bearer_token: str,
        target: str,
        workspace_id: str | None,
    ) -> Any:
        seen.update(
            {
                "atlas_url": atlas_url,
                "api_key": api_key,
                "bearer_token": bearer_token,
                "target": target,
                "workspace_id": workspace_id,
            }
        )
        return ContributionResult(
            attempted=1,
            created=1,
            failed=0,
            errors=[],
            run_id="remote-session",
            sync_status="synced",
            duplicate=False,
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync)

    await _runs_sync(config, run_id, atlas_url=None, api_key=None, target=None, workspace=None)

    assert seen == {
        "atlas_url": "https://atlas.example",
        "api_key": "",
        "bearer_token": "api-jwt",
        "target": "workspace",
        "workspace_id": "org-123",
    }
    assert "remote-session" in output.getvalue()


@pytest.mark.asyncio
async def test_sync_defaults_legacy_logged_in_session_to_public(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in syncs without old target metadata use public review by default."""
    output = capture_consoles(monkeypatch, __import__("atlas_scout.cli", fromlist=["console"]))
    config = build_config(tmp_path)
    run_id = await seed_run_with_artifacts(config)
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        "atlas_scout.cli.load_session",
        lambda: workspace_session().__class__(
            atlas_url="https://atlas.example",
            access_token="worker-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
        ),
    )

    class FakeDeviceAuthClient:
        async def exchange_session_for_api_token(
            self,
            atlas_url: str,
            *,
            session_token: str,
            worker_name: str,
            default_upload_target: str,
            worker_id: str | None = None,
            workspace_id: str | None = None,
            search_key_configured: bool = False,
        ) -> ScoutTokenExchange:
            assert atlas_url == "https://atlas.example"
            assert session_token == "worker-token"
            assert worker_name
            assert default_upload_target == "public"
            assert worker_id == "worker-123"
            assert workspace_id is None
            assert search_key_configured is False
            return ScoutTokenExchange(
                token="api-jwt",
                worker_id="worker-123",
                user_id="user-123",
                user_email="user@example.org",
                workspace_id=None,
            )

    monkeypatch.setattr("atlas_scout.cli.DeviceAuthClient", FakeDeviceAuthClient)

    async def fake_sync(
        _artifacts: Any,
        *,
        atlas_url: str,
        api_key: str,
        bearer_token: str,
        target: str,
        workspace_id: str | None,
    ) -> Any:
        seen.update(
            {
                "atlas_url": atlas_url,
                "api_key": api_key,
                "bearer_token": bearer_token,
                "target": target,
                "workspace_id": workspace_id,
            }
        )
        return ContributionResult(
            attempted=1,
            created=1,
            failed=0,
            errors=[],
            run_id="remote-public",
            sync_status="synced",
            duplicate=False,
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync)

    await _runs_sync(config, run_id, atlas_url=None, api_key=None, target=None, workspace=None)

    assert seen == {
        "atlas_url": "https://atlas.example",
        "api_key": "",
        "bearer_token": "api-jwt",
        "target": "public",
        "workspace_id": None,
    }
    assert "remote-public" in output.getvalue()
