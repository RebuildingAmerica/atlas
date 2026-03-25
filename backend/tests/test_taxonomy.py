"""Taxonomy tests."""

from atlas.taxonomy import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    get_issue_area_by_slug,
    get_issues_by_domain,
)

# Constants
EXPECTED_DOMAIN_COUNT = 11
EXPECTED_TOTAL_ISSUES = 47
EXPECTED_ECONOMIC_SECURITY_ISSUES = 5


class TestTaxonomy:
    """Tests for issue area taxonomy."""

    def test_domains_exist(self) -> None:
        """Test that all expected domains exist."""
        assert len(DOMAINS) == EXPECTED_DOMAIN_COUNT
        expected_domains = {
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
        }
        assert set(DOMAINS) == expected_domains

    def test_issue_count(self) -> None:
        """Test that we have 47 issue areas total."""
        total_issues = sum(len(issues) for issues in ISSUE_AREAS_BY_DOMAIN.values())
        assert total_issues == EXPECTED_TOTAL_ISSUES

    def test_each_domain_has_issues(self) -> None:
        """Test that each domain has at least one issue area."""
        for domain in DOMAINS:
            assert domain in ISSUE_AREAS_BY_DOMAIN
            assert len(ISSUE_AREAS_BY_DOMAIN[domain]) > 0

    def test_get_issue_area_by_slug(self) -> None:
        """Test retrieving issue area by slug."""
        issue = get_issue_area_by_slug("worker_cooperatives")
        assert issue is not None
        assert issue.name == "Worker Cooperatives"
        assert issue.slug == "worker_cooperatives"
        assert issue.domain == "Labor and Worker Power"

    def test_get_issue_area_invalid_slug(self) -> None:
        """Test that invalid slug returns None."""
        issue = get_issue_area_by_slug("invalid_slug_that_does_not_exist")
        assert issue is None

    def test_get_issues_by_domain(self) -> None:
        """Test retrieving issues by domain."""
        issues = get_issues_by_domain("Economic Security")
        assert len(issues) == EXPECTED_ECONOMIC_SECURITY_ISSUES
        slugs = {issue.slug for issue in issues}
        expected_slugs = {
            "automation_and_ai_displacement",
            "gig_economy_and_precarious_work",
            "income_inequality_and_wealth_concentration",
            "healthcare_economics_and_medical_debt",
            "student_debt_and_college_affordability",
        }
        assert slugs == expected_slugs

    def test_get_issues_invalid_domain(self) -> None:
        """Test that invalid domain returns empty list."""
        issues = get_issues_by_domain("Invalid Domain")
        assert issues == []

    def test_all_issue_slugs_set(self) -> None:
        """Test that ALL_ISSUE_SLUGS contains all issue areas."""
        assert len(ALL_ISSUE_SLUGS) == EXPECTED_TOTAL_ISSUES
        assert "worker_cooperatives" in ALL_ISSUE_SLUGS
        assert "housing_affordability" in ALL_ISSUE_SLUGS


class TestSearchTerms:
    """Tests for search term mappings."""

    def test_search_terms_complete(self) -> None:
        """Test that all issue areas have search terms."""
        for slug in ALL_ISSUE_SLUGS:
            assert slug in ISSUE_SEARCH_TERMS
            assert isinstance(ISSUE_SEARCH_TERMS[slug], list)
            assert len(ISSUE_SEARCH_TERMS[slug]) > 0

    def test_search_terms_are_strings(self) -> None:
        """Test that all search terms are non-empty strings."""
        for terms in ISSUE_SEARCH_TERMS.values():
            for term in terms:
                assert isinstance(term, str)
                assert len(term) > 0

    def test_specific_search_terms(self) -> None:
        """Test specific search term mappings."""
        # Test housing affordability
        housing_terms = ISSUE_SEARCH_TERMS["housing_affordability"]
        assert "affordable housing" in housing_terms
        assert "rent" in housing_terms
        assert "community land trust" in housing_terms

        # Test worker cooperatives
        coop_terms = ISSUE_SEARCH_TERMS["worker_cooperatives"]
        assert "worker cooperative" in coop_terms
        assert "worker-owned" in coop_terms
        assert "co-op" in coop_terms

    def test_no_extra_slugs(self) -> None:
        """Test that search terms don't have extra slugs."""
        for slug in ISSUE_SEARCH_TERMS:
            assert slug in ALL_ISSUE_SLUGS

    def test_search_terms_count(self) -> None:
        """Test that we have search terms for all 47 issue areas."""
        assert len(ISSUE_SEARCH_TERMS) == EXPECTED_TOTAL_ISSUES
