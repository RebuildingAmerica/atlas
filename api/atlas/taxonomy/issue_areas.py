"""Issue area taxonomy for The Atlas."""

from __future__ import annotations

from dataclasses import dataclass

from atlas.taxonomy.issue_areas_data import ISSUE_AREAS_BY_DOMAIN_ROWS

__all__ = [
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]


@dataclass(frozen=True)
class IssueArea:
    """An issue area within a domain."""

    slug: str
    """Unique identifier for the issue area (e.g., 'worker_cooperatives')."""

    name: str
    """Human-readable name (e.g., 'Worker Cooperatives')."""

    description: str
    """Brief description of what this issue area covers."""

    domain: str
    """The domain this issue area belongs to."""


_ISSUE_AREAS: dict[str, IssueArea] = {}


def _register_issues(domain: str, issues: list[tuple[str, str, str]]) -> None:
    """Register issues for a domain."""
    for slug, name, description in issues:
        _ISSUE_AREAS[slug] = IssueArea(
            slug=slug,
            name=name,
            description=description,
            domain=domain,
        )


for domain, issues in ISSUE_AREAS_BY_DOMAIN_ROWS.items():
    _register_issues(domain, issues)


DOMAINS = list(ISSUE_AREAS_BY_DOMAIN_ROWS)

ISSUE_AREAS_BY_DOMAIN: dict[str, list[IssueArea]] = {
    domain: [issue for issue in _ISSUE_AREAS.values() if issue.domain == domain]
    for domain in DOMAINS
}


def get_issue_area_by_slug(slug: str) -> IssueArea | None:
    """Get an issue area by its slug."""
    return _ISSUE_AREAS.get(slug)


def get_issues_by_domain(domain: str) -> list[IssueArea]:
    """Get all issue areas for a domain."""
    return ISSUE_AREAS_BY_DOMAIN.get(domain, [])


ALL_ISSUE_SLUGS = set(_ISSUE_AREAS.keys())
