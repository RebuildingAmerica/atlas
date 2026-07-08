"""Issue area taxonomy and domain lookup for the Atlas ecosystem."""

from __future__ import annotations

import atlas_shared.taxonomy_issue_areas_data as _issue_area_data  # noqa: F401
from atlas_shared.taxonomy_support import _ISSUE_AREAS, IssueArea

__all__ = [
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]

DOMAINS: list[str] = [
    "Economic Security",
    "Housing and the Built Environment",
    "Climate and Environment",
    "Democracy and Governance",
    "Technology and Information",
    "Education",
    "Health and Social Connection",
    "Infrastructure and Public Goods",
    "Justice and Public Safety",
    "Rural-Urban Divide",
    "Labor and Worker Power",
]

ISSUE_AREAS_BY_DOMAIN: dict[str, list[IssueArea]] = {
    domain: [issue for issue in _ISSUE_AREAS.values() if issue.domain == domain]
    for domain in DOMAINS
}

ALL_ISSUE_SLUGS: set[str] = set(_ISSUE_AREAS.keys())


def get_issue_area_by_slug(slug: str) -> IssueArea | None:
    """Return the issue area for a slug, or None if it is unknown."""
    return _ISSUE_AREAS.get(slug)


def get_issues_by_domain(domain: str) -> list[IssueArea]:
    """Return the issue areas for a given domain name."""
    return ISSUE_AREAS_BY_DOMAIN.get(domain, [])
