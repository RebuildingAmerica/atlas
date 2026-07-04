"""Scout runs sync auth and upload-destination tests."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

import pytest
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStatus,
)
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.auth import ScoutSession, ScoutTokenExchange
from atlas_scout.cli import _runs_sync
from atlas_scout.config import ContributionConfig, ScoutConfig, StoreConfig
from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from pathlib import Path


def _capture_consoles(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
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


def _config(tmp_path: Path) -> ScoutConfig:
    return ScoutConfig(
        contribution=ContributionConfig(api_key="", atlas_url=""),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )


async def _seed_run_with_artifacts(config: ScoutConfig) -> str:
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(location_query="Austin, TX", state="TX", issue_areas=["housing"]),
            status=DiscoveryRunStatus.COMPLETED,
        ),
    )
    await store.save_run_artifacts(run_id, artifacts)
    await store.close()
    return run_id


def _workspace_session() -> ScoutSession:
    return ScoutSession(
        atlas_url="https://atlas.example",
        access_token="device-session-token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="user@example.org",
        default_upload_target="workspace",
        workspace_id="org-123",
    )


@pytest.mark.asyncio
async def test_sync_uses_login_session_api_token_and_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in sync exchanges the device session for an API bearer token."""
    output = _capture_consoles(monkeypatch)
    config = _config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)
    seen: dict[str, object] = {}

    monkeypatch.setattr("atlas_scout.cli.load_session", _workspace_session)

    class FakeDeviceAuthClient:
        async def exchange_session_for_api_token(
            self,
            atlas_url: str,
            *,
            session_token: str,
        ) -> ScoutTokenExchange:
            assert atlas_url == "https://atlas.example"
            assert session_token == "device-session-token"
            return ScoutTokenExchange(
                token="api-jwt",
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
        from atlas_scout.steps.contribute import ContributionResult

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
async def test_sync_requires_upload_target_for_logged_in_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in syncs fail explicitly until the upload destination is known."""
    output = _capture_consoles(monkeypatch)
    config = _config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)
    monkeypatch.setattr(
        "atlas_scout.cli.load_session",
        lambda: ScoutSession(
            atlas_url="https://atlas.example",
            access_token="worker-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
        ),
    )

    with pytest.raises(SystemExit):
        await _runs_sync(config, run_id, atlas_url=None, api_key=None, target=None, workspace=None)

    assert "Upload target required" in output.getvalue()


@pytest.mark.asyncio
async def test_sync_requires_workspace_for_workspace_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Workspace syncs need an explicit workspace when the session has none."""
    output = _capture_consoles(monkeypatch)
    config = _config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)
    monkeypatch.setattr(
        "atlas_scout.cli.load_session",
        lambda: ScoutSession(
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
