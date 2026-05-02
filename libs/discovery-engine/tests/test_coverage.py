"""Tests for shared coverage and gap-analysis primitives."""

from __future__ import annotations

from atlas_shared import DOMAINS, ISSUE_AREAS_BY_DOMAIN

from atlas_discovery_engine.coverage import CoverageSummary, summarize_issue_counts


def test_empty_counts_marks_every_slug_missing() -> None:
    summary = summarize_issue_counts({})

    assert isinstance(summary, CoverageSummary)
    assert summary.covered_slugs == []
    assert summary.thin_slugs == []
    assert summary.uncovered_domains == DOMAINS
    total_slugs = sum(len(issues) for issues in ISSUE_AREAS_BY_DOMAIN.values())
    assert len(summary.missing_slugs) == total_slugs
    assert summary.issue_counts == {}


def test_categorizes_slugs_by_count() -> None:
    counts = {
        "automation_and_ai_displacement": 5,
        "gig_economy_and_precarious_work": 1,
        "income_inequality_and_wealth_concentration": 2,
    }

    summary = summarize_issue_counts(counts)

    assert "automation_and_ai_displacement" in summary.covered_slugs
    assert "gig_economy_and_precarious_work" in summary.thin_slugs
    assert "income_inequality_and_wealth_concentration" in summary.thin_slugs
    assert "automation_and_ai_displacement" not in summary.missing_slugs
    assert summary.issue_counts == counts


def test_uncovered_domain_when_all_issues_have_zero() -> None:
    economic_security_slugs = [issue.slug for issue in ISSUE_AREAS_BY_DOMAIN["Economic Security"]]
    counts = dict.fromkeys(economic_security_slugs, 5)

    summary = summarize_issue_counts(counts)

    assert "Economic Security" not in summary.uncovered_domains
    other_domains = [d for d in DOMAINS if d != "Economic Security"]
    for domain in other_domains:
        assert domain in summary.uncovered_domains


def test_issue_names_includes_every_slug() -> None:
    summary = summarize_issue_counts({})

    expected_slugs = {issue.slug for issues in ISSUE_AREAS_BY_DOMAIN.values() for issue in issues}
    assert set(summary.issue_names.keys()) == expected_slugs
    for issues in ISSUE_AREAS_BY_DOMAIN.values():
        for issue in issues:
            assert summary.issue_names[issue.slug] == issue.name
