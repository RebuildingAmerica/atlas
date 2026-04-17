"""Taxonomy module for issue areas and domains."""

from atlas.domains.catalog.taxonomy.issue_areas import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    IssueArea,
    get_issue_area_by_slug,
    get_issues_by_domain,
)
from atlas.domains.catalog.taxonomy.search_terms import ISSUE_SEARCH_TERMS

__all__ = [
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "ISSUE_SEARCH_TERMS",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]
