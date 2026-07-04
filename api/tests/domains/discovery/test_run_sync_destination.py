"""Discovery run sync upload-destination tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunSyncRequest,
    DiscoverySyncInfo,
)
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api as discovery_api


def _local_actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )


def _workspace_actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="workspace-user",
        email="workspace-user@atlas.test",
        auth_type="oauth_jwt",
        org_id="org-123",
        permissions={"discovery": ["write"]},
    )


def _unscoped_actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="unscoped-user",
        email="unscoped-user@atlas.test",
        auth_type="oauth_jwt",
        permissions={"discovery": ["write"]},
    )


def _bundle(local_run_id: str) -> DiscoveryRunSyncRequest:
    return DiscoveryRunSyncRequest(
        artifacts=DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Wichita, KS",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id=local_run_id, sync_status="ready"),
            ),
            stats=DiscoveryRunStats(
                queries_generated=1,
                sources_fetched=0,
                sources_processed=0,
                entries_extracted=0,
                entries_after_dedup=0,
                entries_confirmed=0,
            ),
            sources=[],
            ranked_entries=[],
        )
    )


@pytest.mark.asyncio
async def test_rejects_unknown_upload_target(test_db: object) -> None:
    """Scout sync destinations must be explicit known values when provided."""
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.sync_discovery_run(
            _bundle("local_bad_target"),
            response=None,
            actor=_local_actor(),
            db=test_db,
            x_atlas_upload_target="elsewhere",
            x_atlas_workspace_id=None,
        )

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST


@pytest.mark.asyncio
async def test_records_private_workspace_run_ownership(test_db: object) -> None:
    """Workspace-targeted Scout syncs are owned privately by that workspace."""
    response = await discovery_api.sync_discovery_run(
        _bundle("local_workspace"),
        response=None,
        actor=_workspace_actor(),
        db=test_db,
        x_atlas_upload_target="workspace",
        x_atlas_workspace_id="org-123",
    )

    ownership = await OwnershipCRUD.get_ownership(test_db, response.run_id, "discovery_run")
    assert ownership is not None
    assert ownership.org_id == "org-123"
    assert ownership.visibility == "private"
    assert ownership.created_by == "workspace-user"


@pytest.mark.asyncio
async def test_rejects_workspace_target_without_workspace(test_db: object) -> None:
    """Workspace-targeted Scout syncs require a workspace id."""
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.sync_discovery_run(
            _bundle("local_workspace_missing"),
            response=None,
            actor=_local_actor(),
            db=test_db,
            x_atlas_upload_target="workspace",
            x_atlas_workspace_id=None,
        )

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST


@pytest.mark.asyncio
async def test_rejects_workspace_target_without_actor_org_context(test_db: object) -> None:
    """Workspace-targeted Scout syncs require a token bound to that workspace."""
    with pytest.raises(HTTPException) as exc_info:
        await discovery_api.sync_discovery_run(
            _bundle("local_unscoped_workspace"),
            response=None,
            actor=_unscoped_actor(),
            db=test_db,
            x_atlas_upload_target="workspace",
            x_atlas_workspace_id="org-123",
        )

    assert exc_info.value.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.asyncio
async def test_public_target_leaves_run_unowned(test_db: object) -> None:
    """Public contribution syncs do not become workspace-private runs."""
    response = await discovery_api.sync_discovery_run(
        _bundle("local_public"),
        response=None,
        actor=_local_actor(),
        db=test_db,
        x_atlas_upload_target="public",
        x_atlas_workspace_id=None,
    )

    ownership = await OwnershipCRUD.get_ownership(test_db, response.run_id, "discovery_run")
    assert ownership is None
