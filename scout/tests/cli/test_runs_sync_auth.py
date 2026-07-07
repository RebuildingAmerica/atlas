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
from atlas_scout.auth.errors import DeviceAuthError
from atlas_scout.cli import _runs_sync, _should_sync_after_run
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


def test_should_sync_after_run_defaults_to_logged_in_artifact_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in runs with canonical artifacts should sync without extra flags."""
    monkeypatch.setattr("atlas_scout.cli.load_session", _workspace_session)

    assert (
        _should_sync_after_run(
            _config(tmp_path),
            result_artifacts_available=True,
            sync_after_run=None,
        )
        is True
    )


def test_should_sync_after_run_skips_duplicates_and_missing_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Manual opt-out, API-key contribution mode, and missing artifacts should not auto-sync."""
    monkeypatch.setattr("atlas_scout.cli.load_session", _workspace_session)

    assert (
        _should_sync_after_run(
            _config(tmp_path),
            result_artifacts_available=True,
            sync_after_run=False,
        )
        is False
    )
    assert (
        _should_sync_after_run(
            ScoutConfig(
                contribution=ContributionConfig(
                    enabled=True,
                    api_key="key",
                    atlas_url="https://atlas.example",
                ),
                store=StoreConfig(path=str(tmp_path / "scout.db")),
            ),
            result_artifacts_available=True,
            sync_after_run=None,
        )
        is False
    )
    assert (
        _should_sync_after_run(
            _config(tmp_path),
            result_artifacts_available=False,
            sync_after_run=None,
        )
        is False
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
async def test_sync_defaults_legacy_logged_in_session_to_public(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in syncs without old target metadata use public review by default."""
    output = _capture_consoles(monkeypatch)
    config = _config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)
    seen: dict[str, object] = {}
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


@pytest.mark.asyncio
async def test_sync_session_exchange_error_is_user_facing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Network/auth exchange failures should not dump a Python traceback."""
    output = _capture_consoles(monkeypatch)
    config = _config(tmp_path)
    run_id = await _seed_run_with_artifacts(config)
    monkeypatch.setattr("atlas_scout.cli.load_session", _workspace_session)

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
