"""Org-scoped private entry endpoints."""

from __future__ import annotations

import ipaddress
import logging
import re
from collections.abc import AsyncGenerator  # noqa: TC003
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.catalog.models.ownership import (
    DirectoryConfigModel,
    DirectoryDomainAlreadyClaimedError,
    DirectoryDomainModel,
    OwnershipCRUD,
)
from atlas.domains.catalog.services.directory_domains import (
    DirectoryDomainNotConfiguredError,
    DirectoryDomainVerificationService,
    DnsDirectoryDomainTxtResolver,
    directory_domain_verification_host,
)
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
DIRECTORY_DOMAIN_MAX_LENGTH = 253
DIRECTORY_DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


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


class PublicDirectoryScope(BaseModel):
    """Derived public scope for a workspace directory."""

    issue_area_ids: list[str] = Field(default_factory=list)
    geography_labels: list[str] = Field(default_factory=list)
    entry_types: list[str] = Field(default_factory=list)


class PublicDirectoryStats(BaseModel):
    """Public counts that help visitors understand directory coverage."""

    record_count: int = Field(..., ge=0)
    source_count: int = Field(..., ge=0)
    source_backed_record_count: int = Field(..., ge=0)
    last_reviewed_at: str | None = None


class PublicDirectoryPublication(BaseModel):
    """Public/private boundary metadata for a directory."""

    visibility: Literal["public"] = "public"
    private_notes_exposed: bool = False


class PublicDirectoryMethodology(BaseModel):
    """Plain public methodology for how records qualify and can be corrected."""

    summary: str = "Records qualify after workspace review and linked source evidence."
    source_policy: str = "Every public record includes at least one linked source packet."
    review_policy: str = "Unsourced workspace records are held for review before publication."
    correction_policy: str = (
        "Each listed record accepts stale, incorrect, or missing-context feedback."
    )
    correction_path_template: str = "/feedback/{slug}?kind=incorrect"
    missing_context_path_template: str = "/feedback/{slug}?kind=missing_context"


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

    title: str
    sponsor_label: str | None = None
    workspace: PublicDirectoryWorkspace
    scope: PublicDirectoryScope
    stats: PublicDirectoryStats
    publication: PublicDirectoryPublication = Field(default_factory=PublicDirectoryPublication)
    methodology: PublicDirectoryMethodology = Field(default_factory=PublicDirectoryMethodology)
    entries: list[EntityDetailResponse] = Field(default_factory=list)
    trust_footer: PublicDirectoryTrustFooter = Field(default_factory=PublicDirectoryTrustFooter)
    federation: PublicDirectoryFederation = Field(default_factory=PublicDirectoryFederation)


class DirectoryConfigRequest(BaseModel):
    """Editable public metadata for a workspace directory."""

    title: str | None = Field(default=None, min_length=1, max_length=140)
    sponsor_label: str | None = Field(default=None, min_length=1, max_length=180)
    scope: PublicDirectoryScope | None = None
    methodology: PublicDirectoryMethodology | None = None


class DirectoryConfigResponse(BaseModel):
    """Public directory configuration returned to workspace admins."""

    org_id: str
    title: str | None = None
    sponsor_label: str | None = None
    scope: PublicDirectoryScope = Field(default_factory=PublicDirectoryScope)
    methodology: PublicDirectoryMethodology = Field(default_factory=PublicDirectoryMethodology)
    updated_by: str | None = None
    updated_at: str | None = None


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
        return _normalize_directory_domain(value)


class DirectoryDomainResponse(BaseModel):
    """Custom domain verification state returned to workspace admins."""

    domain: str
    status: str
    verification_host: str
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


def _normalize_directory_domain(value: str) -> str:
    """Return a validated, IDNA-normalized directory domain hostname."""
    domain = value.strip().lower()
    if (
        not domain
        or domain.endswith(".")
        or "*" in domain
        or "://" in domain
        or "/" in domain
        or any(char.isspace() for char in domain)
    ):
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)

    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE) from exc

    if len(ascii_domain) > DIRECTORY_DOMAIN_MAX_LENGTH or "." not in ascii_domain:
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)

    try:
        ipaddress.ip_address(ascii_domain)
    except ValueError:
        pass
    else:
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)

    labels = ascii_domain.split(".")
    if any(not DIRECTORY_DOMAIN_LABEL_RE.fullmatch(label) for label in labels):
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)
    return ascii_domain


def get_directory_domain_verifier() -> DirectoryDomainVerificationService:
    """Build the directory-domain verification service for request handlers."""
    return DirectoryDomainVerificationService(
        txt_resolver=DnsDirectoryDomainTxtResolver(),
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
    _cap: None = Depends(require_capability("public.directories")),
) -> DirectoryTemplatesResponse:
    """List templates that seed a workspace directory's issue and place scope."""
    _verify_org_access(actor, org_id)
    apply_no_store_headers(response)
    return DirectoryTemplatesResponse(templates=DIRECTORY_TEMPLATES)


@router.put(
    "/directory-domain",
    response_model=DirectoryDomainResponse,
    summary="Configure a workspace directory domain",
    operation_id="putOrgDirectoryDomain",
    responses={
        201: {
            "description": "Directory domain created",
            "model": DirectoryDomainResponse,
        },
    },
    tags=["org-entries"],
)
async def configure_directory_domain(
    org_id: str,
    req: DirectoryDomainRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("public.directories")),
) -> DirectoryDomainResponse:
    """Create or replace the workspace directory custom domain resource."""
    _verify_org_access(actor, org_id)
    existing_domain = await OwnershipCRUD.get_directory_domain(db, org_id)
    try:
        domain = await OwnershipCRUD.upsert_directory_domain(db, org_id=org_id, domain=req.domain)
    except DirectoryDomainAlreadyClaimedError as exc:
        raise HTTPException(status_code=409, detail="Directory domain is already claimed.") from exc
    if existing_domain is None:
        response.status_code = status.HTTP_201_CREATED
    apply_no_store_headers(response)
    return _directory_domain_response(domain)


@router.get(
    "/directory-config",
    response_model=DirectoryConfigResponse,
    summary="Get workspace directory configuration",
    operation_id="getOrgDirectoryConfig",
    tags=["org-entries"],
)
async def get_directory_config(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("public.directories")),
) -> DirectoryConfigResponse:
    """Return the editable public framing for a workspace directory."""
    _verify_org_access(actor, org_id)
    config = await OwnershipCRUD.get_directory_config(db, org_id)
    apply_no_store_headers(response)
    return _directory_config_response(org_id, config)


@router.put(
    "/directory-config",
    response_model=DirectoryConfigResponse,
    summary="Update workspace directory configuration",
    operation_id="updateOrgDirectoryConfig",
    tags=["org-entries"],
)
async def update_directory_config(
    org_id: str,
    req: DirectoryConfigRequest,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    _cap: None = Depends(require_capability("public.directories")),
) -> DirectoryConfigResponse:
    """Persist the public title, scope, and methodology for a workspace directory."""
    _verify_org_access(actor, org_id)
    scope = req.scope or PublicDirectoryScope()
    methodology = req.methodology or PublicDirectoryMethodology()
    config = await OwnershipCRUD.upsert_directory_config(
        db,
        org_id=org_id,
        title=req.title,
        sponsor_label=req.sponsor_label,
        issue_area_ids=scope.issue_area_ids,
        geography_labels=scope.geography_labels,
        entry_types=scope.entry_types,
        methodology_summary=methodology.summary,
        source_policy=methodology.source_policy,
        review_policy=methodology.review_policy,
        correction_policy=methodology.correction_policy,
        correction_path_template=methodology.correction_path_template,
        missing_context_path_template=methodology.missing_context_path_template,
        actor_id=actor.user_id,
    )
    apply_no_store_headers(response)
    return _directory_config_response(org_id, config)


@router.put(
    "/directory-domain/verification",
    response_model=DirectoryDomainResponse,
    summary="Verify a workspace directory domain",
    operation_id="putOrgDirectoryDomainVerification",
    tags=["org-entries"],
)
async def verify_directory_domain(
    org_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
    domain_verifier: DirectoryDomainVerificationService = Depends(get_directory_domain_verifier),
    _cap: None = Depends(require_capability("public.directories")),
) -> DirectoryDomainResponse:
    """Mark a workspace directory custom domain verified when DNS TXT proof matches."""
    _verify_org_access(actor, org_id)
    try:
        domain = await domain_verifier.verify(db, org_id)
    except DirectoryDomainNotConfiguredError as exc:
        raise HTTPException(status_code=404, detail="Directory domain not configured") from exc
    if domain is None:
        raise HTTPException(status_code=409, detail="Domain verification failed")
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
    config = await OwnershipCRUD.get_directory_config(db, org_id)
    verified_domain = await OwnershipCRUD.get_verified_directory_domain(db, org_id)
    custom_domain = (
        PublicDirectoryDomain(domain=verified_domain.domain, status=verified_domain.status)
        if verified_domain is not None
        else None
    )

    scope = _effective_public_directory_scope(entries, config)
    methodology = (
        _directory_config_methodology(config)
        if config is not None
        else PublicDirectoryMethodology()
    )
    apply_no_store_headers(response)
    return PublicDirectoryResponse(
        title=config.title
        if config is not None and config.title
        else _public_directory_title(org_id, scope),
        sponsor_label=config.sponsor_label if config is not None else None,
        workspace=PublicDirectoryWorkspace(id=org_id, name=org_id, custom_domain=custom_domain),
        scope=scope,
        stats=_public_directory_stats(entries),
        methodology=methodology,
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
    _cap: None = Depends(require_capability("public.directories")),
) -> PublishEntryResponse:
    """Publish a workspace-owned entry into that workspace's public directory."""
    _verify_org_access(actor, org_id)

    ownership = await OwnershipCRUD.get_ownership(db, entry_id, "entry")
    if ownership is None or ownership.org_id != org_id:
        raise HTTPException(status_code=404, detail="Entry not found")

    should_record_public_improvement = ownership.visibility != "public"

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
    if should_record_public_improvement:
        await OrgUsageEventCRUD.record(
            db,
            OrgUsageEventRecord(
                org_id=org_id,
                actor_id=actor.user_id,
                event_type="public_record_improved",
                resource_type="public_record",
                resource_id=entry_id,
            ),
        )
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
