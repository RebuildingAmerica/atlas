"""User-facing error handling for run sync auth."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.auth.errors import DeviceAuthError
from atlas_scout.cli import _runs_sync
from atlas_scout.store import ScoutStore

from .support import build_config, capture_consoles, seed_run_with_artifacts, workspace_session

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_sync_requires_workspace_for_workspace_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Workspace syncs need an explicit workspace when the session has none."""
    output = capture_consoles(monkeypatch, __import__("atlas_scout.cli", fromlist=["console"]))
    config = build_config(tmp_path)
    run_id = await seed_run_with_artifacts(config)
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

    with pytest.raises(SystemExit):
        await _runs_sync(
            config,
            run_id,
            atlas_url=None,
            api_key=None,
            target="workspace",
            workspace=None,
        )

    assert "Workspace required" in output.getvalue()


@pytest.mark.asyncio
async def test_sync_session_exchange_error_is_user_facing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Network/auth exchange failures should not dump a Python traceback."""
    output = capture_consoles(monkeypatch, __import__("atlas_scout.cli", fromlist=["console"]))
    config = build_config(tmp_path)
    run_id = await seed_run_with_artifacts(config)
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
        ) -> object:
            _ = (
                session_token,
                worker_name,
                default_upload_target,
                worker_id,
                workspace_id,
                search_key_configured,
            )
            raise DeviceAuthError(
                error="network_error",
                description="Could not reach Atlas.",
                url=f"{atlas_url}/api/auth/scout/token",
            )

    monkeypatch.setattr("atlas_scout.cli.DeviceAuthClient", FakeDeviceAuthClient)

    with pytest.raises(SystemExit):
        await _runs_sync(
            config,
            run_id,
            atlas_url="https://missing.example",
            api_key=None,
            target=None,
            workspace=None,
        )

    rendered = output.getvalue()
    assert "Sync failed" in rendered
    assert "Could not exchange your Scout login for an Atlas API token." in rendered
    assert "https://missing.example/api/auth/scout/token" in rendered
    assert "scout login --atlas-url https://missing.example" in rendered
    assert "Traceback" not in rendered

    store = ScoutStore(config.store.path)
    await store.initialize()
    try:
        artifacts = await store.get_run_artifacts(run_id)
    finally:
        await store.close()
    assert artifacts is not None
    assert artifacts.manifest.sync is not None
    assert artifacts.manifest.sync.sync_status == "failed"
    assert artifacts.manifest.sync.last_error == "network_error: Could not reach Atlas."
