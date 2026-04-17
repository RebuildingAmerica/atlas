"""Domain and issue-area resource endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from atlas.domains.catalog.taxonomy import (
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    get_issue_area_by_slug,
    get_issues_by_domain,
)
from atlas.platform.http.cache import apply_static_public_cache
from atlas.platform.mcp.data import AtlasDataService
from atlas.schemas import (
    DomainDetailResponse,
    DomainListResponse,
    DomainResponse,
    IssueAreaListResponse,
    IssueAreaResponse,
)

router = APIRouter()

__all__ = ["router"]


def _domain_slug(domain: str) -> str:
    return domain.lower().replace(" ", "-")


@router.get(
    "/domains",
    response_model=DomainListResponse,
    summary="List domains",
    description="List top-level Atlas issue domains.",
    operation_id="listDomains",
    response_description="A paginated collection of Atlas domains.",
    tags=["domains"],
)
async def list_domains(
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    response: Response | None = None,
) -> DomainListResponse:
    """List Atlas domains as a collection resource."""
    if response is not None:
        apply_static_public_cache(response)
    offset = max(int(cursor), 0) if cursor is not None else 0
    all_items = [
        DomainResponse(
            slug=_domain_slug(domain),
            name=domain,
            issue_area_count=len(ISSUE_AREAS_BY_DOMAIN[domain]),
        )
        for domain in DOMAINS
    ]
    items = all_items[offset : offset + limit]
    total = len(all_items)
    next_cursor = str(offset + limit) if offset + limit < total else None
    return DomainListResponse(items=items, total=total, next_cursor=next_cursor)


@router.get(
    "/domains/{domain_slug}",
    response_model=DomainDetailResponse,
    summary="Get a domain",
    description="Return a single Atlas domain and its issue areas.",
    operation_id="getDomain",
    response_description="The requested Atlas domain.",
    tags=["domains"],
)
async def get_domain(domain_slug: str, response: Response) -> DomainDetailResponse:
    """Get a domain and its issue areas by slug."""
    apply_static_public_cache(response)
    domain = next((value for value in DOMAINS if _domain_slug(value) == domain_slug), None)
    if domain is None:
        raise HTTPException(status_code=404, detail="Domain not found")

    return DomainDetailResponse(
        slug=domain_slug,
        name=domain,
        issue_areas=[
            IssueAreaResponse(
                id=issue.slug,
                slug=issue.slug,
                name=issue.name,
                description=issue.description,
                domain=issue.domain,
            )
            for issue in get_issues_by_domain(domain)
        ],
    )


@router.get(
    "/issue-areas",
    response_model=IssueAreaListResponse,
    summary="List issue areas",
    description="List Atlas issue areas or resolve natural-language issue queries.",
    operation_id="listIssueAreas",
    response_description="A paginated collection of Atlas issue areas.",
    tags=["issue-areas"],
)
async def list_issue_areas(
    query: str | None = Query(None, min_length=1),
    limit: int = Query(25, ge=1, le=100),
    cursor: str | None = Query(None),
    response: Response | None = None,
) -> IssueAreaListResponse:
    """List issue areas, optionally filtered by a natural-language query."""
    if response is not None:
        apply_static_public_cache(response)
    offset = max(int(cursor), 0) if cursor is not None else 0
    if query:
        resolved = await AtlasDataService("sqlite:///unused").resolve_issue_areas(query, limit=200)
        all_items = resolved["items"]
        paged_items = all_items[offset : offset + limit]
        next_cursor = str(offset + limit) if offset + limit < resolved["total"] else None
        return IssueAreaListResponse(
            items=paged_items, total=resolved["total"], next_cursor=next_cursor
        )

    items = [
        IssueAreaResponse(
            id=issue.slug,
            slug=issue.slug,
            name=issue.name,
            description=issue.description,
            domain=issue.domain,
        )
        for domain in DOMAINS
        for issue in ISSUE_AREAS_BY_DOMAIN[domain]
    ]
    total = len(items)
    limited = items[offset : offset + limit]
    next_cursor = str(offset + limit) if offset + limit < total else None
    return IssueAreaListResponse(items=limited, total=total, next_cursor=next_cursor)


@router.get(
    "/issue-areas/{issue_area_slug}",
    response_model=IssueAreaResponse,
    summary="Get an issue area",
    description="Return one Atlas issue area by slug.",
    operation_id="getIssueArea",
    response_description="The requested Atlas issue area.",
    tags=["issue-areas"],
)
async def get_issue_area(issue_area_slug: str, response: Response) -> IssueAreaResponse:
    """Get a single issue area by slug."""
    apply_static_public_cache(response)
    issue = get_issue_area_by_slug(issue_area_slug)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue area not found")

    return IssueAreaResponse(
        id=issue.slug,
        slug=issue.slug,
        name=issue.name,
        description=issue.description,
        domain=issue.domain,
    )
