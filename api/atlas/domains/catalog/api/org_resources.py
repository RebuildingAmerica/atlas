"""Org-scoped private entry endpoints."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.catalog.models.ownership import DirectoryDomainModel, OwnershipCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD, get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.platform.mcp.data import EntityRecordContext, _entity_record, _source_record
from atlas.schemas import (
    EntityCreateRequest,
    EntityDetailResponse,
    EntityUpdateRequest,
    SourceResponse,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor
    from atlas.domains.catalog.models.entry import EntryModel

logger = logging.getLogger(__name__)

router = APIRouter()

__all__ = ["router"]

INVALID_DIRECTORY_DOMAIN_MESSAGE = "Enter a bare domain name, such as guide.example.org."


class PublishEntryResponse(BaseModel):
    """Response returned when a workspace entry's visibility changes."""

    entry_id: str
    visibility: str


class HeldPublishResponse(BaseModel):
    """Response detail returned when a tenant publish is held for review."""

    entry_id: str
    visibility: str = "private"
    hold_reason: str
    review_item_id: str


class PublicDirectoryDomain(BaseModel):
    """Verified custom domain exposed on a public directory."""

    domain: str
    status: str


class PublicDirectoryWorkspace(BaseModel):
    """Workspace identity exposed on a public directory."""

    id: str
    name: str
    custom_domain: PublicDirectoryDomain | None = None


class PublicDirectoryTrustFooter(BaseModel):
    """Trust footer metadata every tenant directory carries."""

    label: str = "Powered by Atlas"
    provenance_required: bool = True
    body: str = "Every listed profile keeps source packets and claim-level evidence."


class PublicDirectoryFederation(BaseModel):
    """Federation metadata for records shared back into the Atlas commons."""

    label: str = "Shared with the Atlas commons"
    shared_record_count: int = 0
    source_backed_record_count: int = 0
    review_required: bool = True
    status: str = "open_with_review_gate"
    minimum_confidence: str = "source-backed public record"
    provenance_stamped_ingestion: bool = True
    body: str = (
        "Public records from this directory can be reused by other Atlas-powered directories only "
        "with source evidence and workspace review."
    )


class PublicDirectoryResponse(BaseModel):
    """Public, source-linked directory published by a workspace."""

    workspace: PublicDirectoryWorkspace
    entries: list[EntityDetailResponse] = Field(default_factory=list)
    trust_footer: PublicDirectoryTrustFooter = Field(default_factory=PublicDirectoryTrustFooter)
    federation: PublicDirectoryFederation = Field(default_factory=PublicDirectoryFederation)


class DirectoryTemplatePlaceScope(BaseModel):
    """Place defaults seeded by a directory template."""

    geo_specificity: str
    city: str | None = None
    state: str | None = None
    region: str | None = None


class DirectoryTemplateResponse(BaseModel):
    """Template for starting a focused tenant directory."""

    id: str
    label: str
    description: str
    issue_area_ids: list[str]
    entry_types: list[str]
    place_scope: DirectoryTemplatePlaceScope


class DirectoryTemplatesResponse(BaseModel):
    """Collection of workspace directory templates."""

    templates: list[DirectoryTemplateResponse]


class DirectoryDomainRequest(BaseModel):
    """Custom domain a workspace wants to bind to its public directory."""

    domain: str = Field(min_length=3, max_length=253)

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        """Normalize and reject values that are not bare hostnames."""
        domain = value.strip().lower()
        if "://" in domain or "/" in domain or " " in domain or "." not in domain:
            raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)
        return domain


class DirectoryDomainVerifyRequest(BaseModel):
    """TXT record proof for a workspace directory domain."""

    txt_record: str = Field(min_length=1)


class DirectoryDomainResponse(BaseModel):
    """Custom domain verification state returned to workspace admins."""

    domain: str
    status: str
    verification_token: str


DIRECTORY_TEMPLATES = [
    DirectoryTemplateResponse(
        id="housing-coalition",
        label="Housing coalition map",
        description="Local housing actors, tenant organizations, public agencies, and partners.",
        issue_area_ids=["housing_affordability"],
        entry_types=["organization", "person", "initiative"],
        place_scope=DirectoryTemplatePlaceScope(geo_specificity="local"),
    ),
    DirectoryTemplateResponse(
        id="civic-newsroom-sourcebook",
        label="Civic newsroom sourcebook",
        description="Interview-ready people and organizations for a local reporting beat.",
        issue_area_ids=["civic_participation", "local_media"],
        entry_types=["person", "organization"],
        place_scope=DirectoryTemplatePlaceScope(geo_specificity="local"),
    ),
    DirectoryTemplateResponse(
        id="regional-ecosystem-map",
        label="Regional ecosystem map",
        description="Regional actors and initiatives across a multi-city issue landscape.",
        issue_area_ids=["workforce_development", "economic_development"],
        entry_types=["organization", "initiative", "campaign"],
        place_scope=DirectoryTemplatePlaceScope(geo_specificity="regional"),
    ),
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
            str(source["published_date"] or source["ingested_at"][:10])
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
                    extraction_context=source["extraction_context"],
                    flag_summary=None,
                )
            )
            for source in sources
        ],
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
        verification_token=domain.verification_token,
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


async def _source_count_for_entry(conn: aiosqlite.Connection, entry_id: str) -> int:
    """Return the number of source packets linked to an entry."""
    _entry, sources = await EntryCRUD.get_with_sources(conn, entry_id)
    return len(sources)


@router.get(
    "/directory-templates",
    response_model=DirectoryTemplatesResponse,
    summary="List workspace directory templates",
    operation_id="listOrgDirectoryTemplates",
    tags=["org-entries"],
)
async def list_directory_templates(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
) -> DirectoryTemplatesResponse:
    """List templates that seed a workspace directory's issue and place scope."""
    _verify_org_access(actor, org_id)
    apply_no_store_headers(response)
    return DirectoryTemplatesResponse(templates=DIRECTORY_TEMPLATES)


@router.post(
    "/directory-domain",
    response_model=DirectoryDomainResponse,
    status_code=201,
    summary="Configure a workspace directory domain",
    operation_id="configureOrgDirectoryDomain",
    tags=["org-entries"],
)
async def configure_directory_domain(
    org_id: str,
    req: DirectoryDomainRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> DirectoryDomainResponse:
    """Create a verification challenge for a workspace directory custom domain."""
    _verify_org_access(actor, org_id)
    domain = await OwnershipCRUD.upsert_directory_domain(db, org_id=org_id, domain=req.domain)
    apply_no_store_headers(response)
    return _directory_domain_response(domain)


@router.post(
    "/directory-domain/verify",
    response_model=DirectoryDomainResponse,
    summary="Verify a workspace directory domain",
    operation_id="verifyOrgDirectoryDomain",
    tags=["org-entries"],
)
async def verify_directory_domain(
    org_id: str,
    req: DirectoryDomainVerifyRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> DirectoryDomainResponse:
    """Mark a workspace directory custom domain verified when TXT proof matches."""
    _verify_org_access(actor, org_id)
    domain = await OwnershipCRUD.verify_directory_domain(
        db,
        org_id=org_id,
        txt_record=req.txt_record,
    )
    if domain is None:
        raise HTTPException(status_code=400, detail="Domain verification failed")
    apply_no_store_headers(response)
    return _directory_domain_response(domain)


@router.get(
    "/public-directory",
    response_model=PublicDirectoryResponse,
    summary="Get public workspace directory",
    operation_id="getPublicOrgDirectory",
    tags=["org-entries"],
)
async def get_public_directory(
    org_id: str,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
) -> PublicDirectoryResponse:
    """Return source-linked entries a workspace has published publicly."""
    ownership_records = await OwnershipCRUD.list_by_org(
        db, org_id, resource_type="entry", visibility="public"
    )
    entries: list[EntityDetailResponse] = []
    for record in ownership_records:
        entry = await _entry_to_source_linked_detail_response(db, record.resource_id)
        if entry is not None:
            entries.append(entry)
    verified_domain = await OwnershipCRUD.get_verified_directory_domain(db, org_id)
    custom_domain = (
        PublicDirectoryDomain(domain=verified_domain.domain, status=verified_domain.status)
        if verified_domain is not None
        else None
    )

    apply_no_store_headers(response)
    return PublicDirectoryResponse(
        workspace=PublicDirectoryWorkspace(id=org_id, name=org_id, custom_domain=custom_domain),
        entries=entries,
        federation=_public_directory_federation(entries),
    )


@router.get(
    "",
    response_model=list[EntityDetailResponse],
    summary="List private entries for org",
    operation_id="listOrgEntries",
    tags=["org-entries"],
)
async def list_org_entries(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[EntityDetailResponse]:
    """List private entries owned by the org."""
    _verify_org_access(actor, org_id)

    ownership_records = await OwnershipCRUD.list_by_org(
        db, org_id, resource_type="entry", visibility="private"
    )
    entries: list[EntityDetailResponse] = []
    for record in ownership_records:
        entry = await EntryCRUD.get_by_id(db, record.resource_id)
        if entry is not None:
            issue_areas = await EntryCRUD.get_issue_areas(db, entry.id)
            entries.append(await _entry_to_detail_response(entry, issue_areas))

    apply_no_store_headers(response)
    return entries


@router.post(
    "",
    response_model=EntityDetailResponse,
    status_code=201,
    summary="Create a private entry for org",
    operation_id="createOrgEntry",
    tags=["org-entries"],
)
async def create_org_entry(
    org_id: str,
    req: EntityCreateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Create a private entry owned by the org."""
    _verify_org_access(actor, org_id)

    assert req.geo_specificity is not None  # guaranteed by model validator

    entity_id = await EntryCRUD.create(
        db,
        entry_type=req.type,
        name=req.name,
        description=req.description,
        city=req.city,
        state=req.state,
        geo_specificity=req.geo_specificity,
        region=req.region,
        full_address=req.full_address,
        website=req.website,
        email=req.email,
        phone=req.phone,
        social_media=req.social_media,
        affiliated_org_id=req.affiliated_org_id,
        first_seen=req.first_seen,
        last_seen=req.last_seen,
        contact_status=req.contact_status,
        editorial_notes=req.editorial_notes,
        priority=req.priority,
    )

    for linked_issue_area in req.issue_areas:
        await db.execute(
            """
            INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
            VALUES (?, ?, datetime('now'))
            """,
            (entity_id, linked_issue_area),
        )
    await db.commit()

    await OwnershipCRUD.create_ownership(
        db,
        resource_id=entity_id,
        resource_type="entry",
        org_id=org_id,
        visibility="private",
        created_by=actor.user_id,
    )

    entry = await EntryCRUD.get_by_id(db, entity_id)
    assert entry is not None, "EntryCRUD.create just returned this id; row must exist"

    apply_no_store_headers(response)
    return await _entry_to_detail_response(entry, req.issue_areas)


@router.get(
    "/{entry_id}",
    response_model=EntityDetailResponse,
    summary="Get a private entry",
    operation_id="getOrgEntry",
    tags=["org-entries"],
)
async def get_org_entry(
    org_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Get a single private entry owned by the org."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    apply_no_store_headers(response)
    return await _entry_to_detail_response(entry, issue_areas)


@router.put(
    "/{entry_id}",
    response_model=EntityDetailResponse,
    summary="Update a private entry",
    operation_id="updateOrgEntry",
    tags=["org-entries"],
)
async def update_org_entry(  # noqa: PLR0913
    org_id: str,
    entry_id: str,
    req: EntityUpdateRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> EntityDetailResponse:
    """Update a private entry owned by the org."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    entry = await EntryCRUD.get_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    update_dict = {
        field: value
        for field, value in req.model_dump(exclude_unset=True).items()
        if value is not None
    }

    if update_dict:
        await EntryCRUD.update(db, entry_id, **update_dict)

    updated_entry = await EntryCRUD.get_by_id(db, entry_id)
    assert updated_entry is not None, "entry existed under this org_id moments ago"

    issue_areas = await EntryCRUD.get_issue_areas(db, entry_id)
    apply_no_store_headers(response)
    return await _entry_to_detail_response(updated_entry, issue_areas)


@router.put(
    "/{entry_id}/publish",
    response_model=PublishEntryResponse,
    summary="Publish a workspace entry",
    operation_id="publishOrgEntry",
    tags=["org-entries"],
)
async def publish_org_entry(
    org_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> PublishEntryResponse:
    """Publish a workspace-owned entry into that workspace's public directory."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    if await _source_count_for_entry(db, entry_id) == 0:
        review_item_id = await ReviewQueueCRUD.enqueue(
            db,
            org_id=org_id,
            entity_id=entry_id,
            kind="tenant_publish",
            hold_reason="source_required_for_public_directory",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
        )
        detail = HeldPublishResponse(
            entry_id=entry_id,
            hold_reason="source_required_for_public_directory",
            review_item_id=review_item_id,
        )
        raise HTTPException(status_code=409, detail=detail.model_dump())

    updated = await OwnershipCRUD.update_visibility(
        db,
        resource_id=entry_id,
        resource_type="entry",
        visibility="public",
    )
    assert updated is not None, "ownership existed moments before the visibility update"
    apply_no_store_headers(response)
    return PublishEntryResponse(entry_id=entry_id, visibility=updated.visibility)


@router.delete(
    "/{entry_id}",
    status_code=204,
    summary="Delete a private entry",
    operation_id="deleteOrgEntry",
    tags=["org-entries"],
)
async def delete_org_entry(
    org_id: str,
    entry_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete a private entry and its ownership record."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    await EntryCRUD.delete(db, entry_id)
    await OwnershipCRUD.delete_ownership(db, entry_id, "entry")
    apply_no_store_headers(response)
