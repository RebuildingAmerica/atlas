"""Support helpers for org-scoped private entry endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException

from atlas.domains.catalog.services.directory_domains import (
    DirectoryDomainVerificationService,
    DnsDirectoryDomainTxtResolver,
    directory_domain_verification_host,
)
from atlas.models import EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.dates import date_string
from atlas.platform.mcp.data import (
    EntityRecordContext,
    _entity_record,
    _source_linked_entity_record,
    _source_record,
)
from atlas.schemas import EntityDetailResponse, SourceResponse

from .org_resources_models import (
    DirectoryConfigResponse,
    DirectoryDomainResponse,
    PublicDirectoryFederation,
    PublicDirectoryMethodology,
    PublicDirectoryScope,
    PublicDirectoryStats,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor
    from atlas.domains.catalog.models.entry import EntryModel
    from atlas.domains.catalog.models.ownership import (
        DirectoryConfigModel,
        DirectoryDomainModel,
    )


__all__ = [
    "_directory_config_methodology",
    "_directory_config_response",
    "_directory_config_scope",
    "_directory_domain_response",
    "_effective_public_directory_scope",
    "_entry_to_detail_response",
    "_entry_to_source_linked_detail_response",
    "_geography_label",
    "_humanize_identifier",
    "_latest_source_date",
    "_public_directory_federation",
    "_public_directory_scope",
    "_public_directory_stats",
    "_public_directory_title",
    "_source_count_for_entry",
    "_verify_org_access",
    "get_db",
    "get_directory_domain_verifier",
]


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency to get database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def get_directory_domain_verifier() -> DirectoryDomainVerificationService:
    """Build the directory-domain verification service for request handlers."""
    return DirectoryDomainVerificationService(
        txt_resolver=DnsDirectoryDomainTxtResolver(),
    )


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(
            status_code=403,
            detail="Access denied: org_id mismatch",
        )


def _directory_domain_response(domain: DirectoryDomainModel) -> DirectoryDomainResponse:
    """Convert a directory domain model into an admin response."""
    return DirectoryDomainResponse(
        domain=domain.domain,
        status=domain.status,
        verification_host=directory_domain_verification_host(domain.domain),
        verification_token=domain.verification_token,
    )


def _directory_config_scope(config: DirectoryConfigModel) -> PublicDirectoryScope:
    """Convert persisted directory scope into the public response model."""
    return PublicDirectoryScope(
        issue_area_ids=config.issue_area_ids,
        geography_labels=config.geography_labels,
        entry_types=config.entry_types,
    )


def _directory_config_methodology(config: DirectoryConfigModel) -> PublicDirectoryMethodology:
    """Convert persisted methodology into a complete public methodology model."""
    defaults = PublicDirectoryMethodology()
    return PublicDirectoryMethodology(
        summary=config.methodology_summary or defaults.summary,
        source_policy=config.source_policy or defaults.source_policy,
        review_policy=config.review_policy or defaults.review_policy,
        correction_policy=config.correction_policy or defaults.correction_policy,
        correction_path_template=config.correction_path_template
        or defaults.correction_path_template,
        missing_context_path_template=config.missing_context_path_template
        or defaults.missing_context_path_template,
    )


def _directory_config_response(
    org_id: str,
    config: DirectoryConfigModel | None,
) -> DirectoryConfigResponse:
    """Convert an optional persisted config into the admin response model."""
    if config is None:
        return DirectoryConfigResponse(org_id=org_id)
    return DirectoryConfigResponse(
        org_id=config.org_id,
        title=config.title,
        sponsor_label=config.sponsor_label,
        scope=_directory_config_scope(config),
        methodology=_directory_config_methodology(config),
        updated_by=config.updated_by,
        updated_at=config.updated_at,
    )


def _public_directory_federation(
    entries: list[EntityDetailResponse],
) -> PublicDirectoryFederation:
    """Build the federation summary for a public workspace directory."""
    source_backed_count = sum(
        1 for entry in entries if entry.claim_evidence.summary.source_count > 0
    )
    return PublicDirectoryFederation(
        shared_record_count=len(entries),
        source_backed_record_count=source_backed_count,
    )


def _geography_label(entry: EntityDetailResponse) -> str | None:
    """Return the most useful public geography label for one directory entry."""
    if entry.address.city and entry.address.state:
        return f"{entry.address.city}, {entry.address.state}"
    if entry.address.city:
        return entry.address.city
    if entry.address.state:
        return entry.address.state
    return entry.address.region


def _latest_source_date(entry: EntityDetailResponse) -> str | None:
    """Return the latest visible source or freshness date for one directory entry."""
    candidates = [
        entry.freshness.latest_source_date,
        *(
            source.freshness.published_date
            or source.freshness.ingested_at
            or source.freshness.created_at
            for source in entry.sources
        ),
    ]
    dates = [candidate[:10] for candidate in candidates if candidate]
    return max(dates) if dates else None


def _public_directory_scope(entries: list[EntityDetailResponse]) -> PublicDirectoryScope:
    """Derive a public scope summary from source-backed directory entries."""
    geography_labels = sorted(
        label for entry in entries if (label := _geography_label(entry)) is not None
    )
    return PublicDirectoryScope(
        issue_area_ids=sorted({issue for entry in entries for issue in entry.issue_area_ids}),
        geography_labels=geography_labels,
        entry_types=sorted({entry.type for entry in entries}),
    )


def _public_directory_stats(entries: list[EntityDetailResponse]) -> PublicDirectoryStats:
    """Derive public coverage stats from source-backed directory entries."""
    last_reviewed_dates = [
        latest_source_date
        for entry in entries
        if (latest_source_date := _latest_source_date(entry)) is not None
    ]
    return PublicDirectoryStats(
        record_count=len(entries),
        source_count=sum(entry.source_count for entry in entries),
        source_backed_record_count=sum(1 for entry in entries if entry.source_count > 0),
        last_reviewed_at=max(last_reviewed_dates) if last_reviewed_dates else None,
    )


def _humanize_identifier(value: str) -> str:
    """Return a compact public label for a slug-like identifier."""
    return value.replace("_", " ").replace("-", " ").title()


def _public_directory_title(
    org_id: str,
    scope: PublicDirectoryScope,
) -> str:
    """Return the best available public title for a derived directory."""
    if len(scope.geography_labels) == 1:
        return f"{scope.geography_labels[0]} civic directory"
    if len(scope.issue_area_ids) == 1:
        return f"{_humanize_identifier(scope.issue_area_ids[0])} civic directory"
    return f"{org_id} civic directory"


def _effective_public_directory_scope(
    entries: list[EntityDetailResponse],
    config: DirectoryConfigModel | None,
) -> PublicDirectoryScope:
    """Return configured scope values while preserving derived coverage where unset."""
    derived_scope = _public_directory_scope(entries)
    if config is None:
        return derived_scope
    configured_scope = _directory_config_scope(config)
    return PublicDirectoryScope(
        issue_area_ids=configured_scope.issue_area_ids or derived_scope.issue_area_ids,
        geography_labels=configured_scope.geography_labels or derived_scope.geography_labels,
        entry_types=configured_scope.entry_types or derived_scope.entry_types,
    )


async def _entry_to_detail_response(
    entry: EntryModel, issue_areas: list[str]
) -> EntityDetailResponse:
    """Convert an EntryModel to an EntityDetailResponse using the canonical record builder."""
    record = _entity_record(
        entry,
        EntityRecordContext(
            issue_area_ids=issue_areas,
            source_types=[],
            source_count=0,
            latest_source_date=None,
            flag_summary=None,
        ),
    )
    return EntityDetailResponse.model_validate(record)


async def _entry_to_source_linked_detail_response(
    conn: aiosqlite.Connection,
    entry_id: str,
) -> EntityDetailResponse | None:
    """Load one entry as a public detail response with linked source packets."""
    loaded = await EntryCRUD.get_with_sources(conn, entry_id)
    entry, sources = loaded
    if entry is None:
        return None
    issue_areas = await EntryCRUD.get_issue_areas(conn, entry_id)
    source_types = sorted({str(source["type"]) for source in sources})
    latest_source_date = next(
        (
            date_string(source.get("published_date") or source.get("ingested_at"))
            for source in sources
            if source.get("published_date") or source.get("ingested_at")
        ),
        None,
    )
    record = _entity_record(
        entry,
        EntityRecordContext(
            issue_area_ids=issue_areas,
            source_types=source_types,
            source_count=len(sources),
            latest_source_date=latest_source_date,
            flag_summary=None,
        ),
    )
    return EntityDetailResponse(
        **record,
        sources=[
            SourceResponse.model_validate(
                _source_record(
                    source,
                    linked_entity_ids=[entry.id],
                    linked_entities=[_source_linked_entity_record(entry)],
                    extraction_context=source["extraction_context"],
                    flag_summary=None,
                )
            )
            for source in sources
        ],
    )


async def _source_count_for_entry(conn: aiosqlite.Connection, entry_id: str) -> int:
    """Return the number of source packets linked to an entry."""
    _entry, sources = await EntryCRUD.get_with_sources(conn, entry_id)
    return len(sources)
