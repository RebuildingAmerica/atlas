"""Issue area taxonomy wrapper for the Atlas API package."""

from atlas_shared.taxonomy_issue_areas import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    IssueArea,
    get_issue_area_by_slug,
    get_issues_by_domain,
)

__all__ = [
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]
