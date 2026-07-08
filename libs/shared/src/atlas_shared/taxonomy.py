"""Public taxonomy facade for the Atlas ecosystem."""

from __future__ import annotations

from atlas_shared.taxonomy_issue_areas import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    IssueArea,
    get_issue_area_by_slug,
    get_issues_by_domain,
)
from atlas_shared.taxonomy_search_terms import ISSUE_SEARCH_TERMS

__all__ = [
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "ISSUE_SEARCH_TERMS",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]
