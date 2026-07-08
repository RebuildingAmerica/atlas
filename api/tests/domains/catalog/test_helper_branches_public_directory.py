"""Tests for catalog helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response

from atlas.domains.catalog.api import org_resources
from atlas.models import EntryCRUD, SourceCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.services.directory_domains import DirectoryDomainVerificationService
from atlas.domains.catalog.services.directory_domains import DirectoryDomainNotConfiguredError


@pytest.mark.asyncio
async def test_entry_to_source_linked_detail_response_returns_none_when_entry_missing(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deleted entries should quietly drop out of public directory renders."""

    async def fake_get_with_sources(
        _db: object, _entry_id: str
    ) -> tuple[object | None, list[object]]:
        return None, []

    monkeypatch.setattr(EntryCRUD, "get_with_sources", fake_get_with_sources)
    result = await org_resources._entry_to_source_linked_detail_response(test_db, "missing")
    assert result is None


@pytest.mark.asyncio
async def test_source_link_tolerates_missing_source_refetch(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Source links should still persist if a follow-up source refetch is unavailable."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Refetch Missing Source Org",
        description="Used to cover source link refetch behavior.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.org/refetch-missing",
        source_type="news_article",
        extraction_method="manual",
        title="Refetch missing source",
    )

    async def missing_source(_conn: object, _source_id: str) -> object:
        return None

    monkeypatch.setattr(SourceCRUD, "get_by_id", missing_source)

    await SourceCRUD.link_to_entry(test_db, entry_id, source_id, "Source refetch missing.")

    cursor = await test_db.execute(
        "SELECT extraction_context FROM entry_sources WHERE entry_id = ? AND source_id = ?",
        (entry_id, source_id),
    )
    row = await cursor.fetchone()
    assert row[0] == "Source refetch missing."


@pytest.mark.asyncio
async def test_get_public_directory_skips_missing_entries(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Public directory listing should ignore ownership rows that no longer resolve."""
    monkeypatch.setattr(
        OwnershipCRUD,
        "list_by_org",
        AsyncMock(return_value=[SimpleNamespace(resource_id="missing-entry")]),
    )
    monkeypatch.setattr(
        org_resources,
        "_entry_to_source_linked_detail_response",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(OwnershipCRUD, "get_directory_config", AsyncMock(return_value=None))
    monkeypatch.setattr(
        OwnershipCRUD, "get_verified_directory_domain", AsyncMock(return_value=None)
    )

    response = Response()
    directory = await org_resources.get_public_directory(
        org_id="local", response=response, db=test_db
    )

    assert directory.entries == []
    assert directory.title == "local civic directory"


@pytest.mark.asyncio
async def test_publish_org_entry_rejects_missing_ownership(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publishing an entry should 404 if the workspace no longer owns it."""
    monkeypatch.setattr(OwnershipCRUD, "get_ownership", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc_info:
        await org_resources.publish_org_entry(
            org_id="local",
            entry_id="missing",
            response=Response(),
            actor=SimpleNamespace(org_id="local"),
            db=test_db,
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_verify_directory_domain_reports_missing_and_failed_verification() -> None:
    """Directory domain verification should stay precise about failure modes."""
    verifier = AsyncMock(spec=DirectoryDomainVerificationService)
    verifier.verify.side_effect = DirectoryDomainNotConfiguredError("missing")
    response = Response()

    with pytest.raises(HTTPException) as exc_info:
        await org_resources.verify_directory_domain(
            org_id="local",
            response=response,
            actor=SimpleNamespace(org_id="local"),
            db=SimpleNamespace(),
            domain_verifier=verifier,
        )
    assert exc_info.value.status_code == 404

    verifier.verify.side_effect = None
    verifier.verify.return_value = None
    with pytest.raises(HTTPException) as exc_info:
        await org_resources.verify_directory_domain(
            org_id="local",
            response=response,
            actor=SimpleNamespace(org_id="local"),
            db=SimpleNamespace(),
            domain_verifier=verifier,
        )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_get_public_directory_uses_generated_title_when_config_is_missing(
    test_db: object,
) -> None:
    """An empty public directory should still render a stable title and shape."""
    response = Response()
    directory = await org_resources.get_public_directory(
        org_id="local",
        response=response,
        db=test_db,
    )

    assert directory.title == "local civic directory"
    assert directory.entries == []
