"""Tests for discovery API helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api as discovery_api
from atlas.models import EntryCRUD


@pytest.mark.parametrize(
    ("upload_target", "workspace_id", "actor_org_id", "expected"),
    [
        (None, None, "local", (None, None)),
        ("public", None, "local", ("public", None)),
        (
            "workspace",
            None,
            None,
            HTTPException(status_code=400, detail="Workspace upload target requires workspace id"),
        ),
        (
            "workspace",
            "org-1",
            None,
            HTTPException(status_code=403, detail="Workspace upload target requires org context"),
        ),
        (
            "workspace",
            "org-2",
            "org-1",
            HTTPException(status_code=403, detail="Workspace upload target does not match actor"),
        ),
        (
            "invalid",
            None,
            "local",
            HTTPException(status_code=400, detail="Invalid Scout upload target"),
        ),
    ],
)
def test_resolve_sync_destination_validates_targets(
    upload_target: str | None,
    workspace_id: str | None,
    actor_org_id: str | None,
    expected: tuple[str | None, str | None] | HTTPException,
) -> None:
    """Scout sync destinations should fail loudly on invalid or mismatched targets."""
    actor = SimpleNamespace(org_id=actor_org_id)
    if isinstance(expected, HTTPException):
        with pytest.raises(HTTPException) as exc_info:
            discovery_api._resolve_sync_destination(
                upload_target=upload_target,
                workspace_id=workspace_id,
                actor=actor,
            )
        assert exc_info.value.status_code == expected.status_code
        assert exc_info.value.detail == expected.detail
        return

    assert (
        discovery_api._resolve_sync_destination(
            upload_target=upload_target,
            workspace_id=workspace_id,
            actor=actor,
        )
        == expected
    )


@pytest.mark.parametrize(
    ("entry_type", "slug", "expected"),
    [
        ("person", "ada-lovelace", "/profiles/people/ada-lovelace"),
        ("organization", "atlas", "/profiles/organizations/atlas"),
        ("other", "atlas", None),
        ("person", None, None),
    ],
)
def test_entry_profile_path_maps_known_types(
    entry_type: str,
    slug: str | None,
    expected: str | None,
) -> None:
    """Only supported entry types should surface public profile paths."""
    assert discovery_api._entry_profile_path(entry_type=entry_type, slug=slug) == expected


@pytest.mark.parametrize(
    ("research_summary", "expected"),
    [
        ({"ranked_leads": "not-a-list"}, []),
        ({"ranked_leads": [{"entry_id": "entry-a"}, {"entry_id": ""}, "bad"]}, ["entry-a"]),
        (None, []),
    ],
)
def test_entry_ids_from_run_summary_skips_non_entry_rows(
    research_summary: object,
    expected: list[str],
) -> None:
    """Only well-formed ranked lead rows should become persisted entry ids."""
    run = SimpleNamespace(research_summary=research_summary)
    assert discovery_api._entry_ids_from_run_summary(run) == expected


@pytest.mark.asyncio
async def test_entry_ids_from_artifacts_skips_unmatched_rows(test_db: object) -> None:
    """Only ranked entries with a durable database match should be returned."""
    ranked_entries = [
        SimpleNamespace(
            entry=SimpleNamespace(
                state="MO",
                city="Kansas City",
                entry_type="organization",
                name="Unmatched Org",
            )
        )
    ]

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            EntryCRUD,
            "list",
            AsyncMock(
                return_value=[
                    SimpleNamespace(
                        id="candidate-1",
                        type="organization",
                        name="Different Org",
                    )
                ]
            ),
        )
        assert await discovery_api._entry_ids_from_artifacts(test_db, ranked_entries) == []
