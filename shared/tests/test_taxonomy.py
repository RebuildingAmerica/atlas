"""Tests for atlas_shared.taxonomy."""

import pytest

from atlas_shared.taxonomy import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    IssueArea,
    get_issue_area_by_slug,
    get_issues_by_domain,
)


def test_domains_has_11_entries() -> None:
    """DOMAINS should contain exactly 11 domain strings."""
    assert len(DOMAINS) == 11


def test_all_issue_slugs_has_51_entries() -> None:
    """ALL_ISSUE_SLUGS should contain exactly 51 unique slugs."""
    assert len(ALL_ISSUE_SLUGS) == 51


def test_every_domain_has_issues() -> None:
    """Every domain in DOMAINS should have at least one issue area."""
    for domain in DOMAINS:
        issues = ISSUE_AREAS_BY_DOMAIN.get(domain, [])
        assert len(issues) > 0, f"Domain '{domain}' has no issue areas"


def test_every_slug_has_search_terms() -> None:
    """Every issue area slug should have at least one search term."""
    for slug in ALL_ISSUE_SLUGS:
        terms = ISSUE_SEARCH_TERMS.get(slug)
        assert terms is not None, f"No search terms for slug '{slug}'"
        assert len(terms) > 0, f"Empty search terms for slug '{slug}'"


def test_get_issue_area_by_slug_found() -> None:
    """get_issue_area_by_slug should return an IssueArea for a known slug."""
    result = get_issue_area_by_slug("worker_cooperatives")
    assert result is not None
    assert isinstance(result, IssueArea)
    assert result.slug == "worker_cooperatives"
    assert result.name == "Worker Cooperatives"
    assert result.domain == "Labor and Worker Power"


def test_get_issue_area_by_slug_not_found() -> None:
    """get_issue_area_by_slug should return None for an unknown slug."""
    result = get_issue_area_by_slug("nonexistent_slug")
    assert result is None


def test_get_issues_by_domain() -> None:
    """get_issues_by_domain should return the correct issue areas for a domain."""
    issues = get_issues_by_domain("Labor and Worker Power")
    assert len(issues) == 5
    slugs = {i.slug for i in issues}
    assert "worker_cooperatives" in slugs
    assert "union_organizing" in slugs
    assert "just_transition" in slugs


def test_get_issues_by_domain_unknown() -> None:
    """get_issues_by_domain should return an empty list for an unknown domain."""
    issues = get_issues_by_domain("Not a Real Domain")
    assert issues == []


def test_issue_area_is_frozen() -> None:
    """IssueArea instances should be immutable (frozen Pydantic model)."""
    issue = get_issue_area_by_slug("housing_affordability")
    assert issue is not None
    with pytest.raises(Exception):
        issue.slug = "mutated"  # type: ignore[misc]


def test_all_issue_areas_have_required_fields() -> None:
    """Every issue area should have non-empty slug, name, description, and domain."""
    for slug in ALL_ISSUE_SLUGS:
        issue = get_issue_area_by_slug(slug)
        assert issue is not None
        assert issue.slug, f"Empty slug for {slug}"
        assert issue.name, f"Empty name for {slug}"
        assert issue.description, f"Empty description for {slug}"
        assert issue.domain, f"Empty domain for {slug}"
        assert issue.domain in DOMAINS, f"Domain '{issue.domain}' not in DOMAINS"
