"""Taxonomy endpoints."""

from fastapi import APIRouter, HTTPException

from atlas.taxonomy import DOMAINS, get_issues_by_domain

router = APIRouter()

__all__ = ["router"]


@router.get("")
async def get_full_taxonomy() -> dict[str, list[dict[str, str]]]:
    """
    Get the full issue area taxonomy.

    Returns all domains and their issue areas with descriptions.
    """
    result = {}
    for domain in DOMAINS:
        issues = get_issues_by_domain(domain)
        result[domain] = [
            {
                "slug": issue.slug,
                "name": issue.name,
                "description": issue.description,
            }
            for issue in issues
        ]
    return result


@router.get("/{domain}")
async def get_domain_issues(domain: str) -> list[dict[str, str]]:
    """
    Get all issue areas for a domain.

    Parameters:
    - domain: domain name (e.g., "Economic Security")

    Returns the list of issues in the domain or 404 if domain not found.
    """
    if domain not in DOMAINS:
        raise HTTPException(
            status_code=404,
            detail=f"Domain not found. Valid domains: {', '.join(DOMAINS)}",
        )

    issues = get_issues_by_domain(domain)
    return [
        {
            "slug": issue.slug,
            "name": issue.name,
            "description": issue.description,
        }
        for issue in issues
    ]
