"""Directory configuration endpoints for org-scoped private entries."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response, status

from atlas.domains.access.capabilities import require_capability
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.principals import AuthenticatedActor  # noqa: TC001
from atlas.domains.catalog.models.ownership import DirectoryDomainAlreadyClaimedError, OwnershipCRUD
from atlas.domains.catalog.services.directory_domains import (
    DirectoryDomainNotConfiguredError,
    DirectoryDomainVerificationService,
)
from atlas.platform.http.cache import apply_no_store_headers
from atlas.schemas import EntityDetailResponse  # noqa: TC001

from .org_resources_models import (
    DIRECTORY_TEMPLATES,
    DirectoryConfigRequest,
    DirectoryConfigResponse,
    DirectoryDomainRequest,
    DirectoryDomainResponse,
    DirectoryTemplatesResponse,
    PublicDirectoryDomain,
    PublicDirectoryMethodology,
    PublicDirectoryResponse,
    PublicDirectoryScope,
    PublicDirectoryWorkspace,
)
from .org_resources_support import (
    _directory_config_methodology,
    _directory_config_response,
    _directory_domain_response,
    _effective_public_directory_scope,
    _entry_to_source_linked_detail_response,
    _public_directory_federation,
    _public_directory_stats,
    _public_directory_title,
    _verify_org_access,
    get_db,
    get_directory_domain_verifier,
)

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter()

__all__ = [
    "configure_directory_domain",
    "get_directory_config",
    "get_public_directory",
    "list_directory_templates",
    "router",
    "update_directory_config",
    "verify_directory_domain",
]


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
    db: object = Depends(get_db),
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
    db: object = Depends(get_db),
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
