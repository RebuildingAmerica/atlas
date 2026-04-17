"""Tests for Step 6: gap_analysis."""

from __future__ import annotations

from atlas_shared import DeduplicatedEntry, RankedEntry

from atlas_scout.steps.gap_analysis import analyze_gaps


def _make_ranked(issue_areas: list[str], name: str = "Test Org") -> RankedEntry:
    entry = DeduplicatedEntry(
        name=name,
        entry_type="organization",
        description="A test organization.",
        city="Austin",
        state="TX",
        issue_areas=issue_areas,
        source_urls=["https://example.com"],
    )
    return RankedEntry(entry=entry, score=0.5)


def test_finds_missing_issues() -> None:
    """Issue areas with zero entries appear in missing_issues."""
    entries = [_make_ranked(["housing_affordability"]) for _ in range(3)]
    report = analyze_gaps("Austin, TX", entries)

    # housing_affordability has 3 entries so it's covered
    assert "housing_affordability" not in report.missing_issues
    # union_organizing has 0 entries so it's missing
    assert "union_organizing" in report.missing_issues


def test_detects_thin_coverage() -> None:
    """Issue areas with 1 or 2 entries appear in thin_issues."""
    entries = [_make_ranked(["union_organizing"])]  # only 1 entry
    report = analyze_gaps("Austin, TX", entries)

    assert "union_organizing" in report.thin_issues
    assert "union_organizing" not in report.missing_issues
    assert "union_organizing" not in report.covered_issues


def test_detects_all_domains_uncovered_when_no_entries() -> None:
    """With no entries, all domains appear in uncovered_domains."""
    report = analyze_gaps("Empty City, TX", [])

    assert len(report.uncovered_domains) > 0
    # All known domains should be uncovered
    from atlas_shared import DOMAINS
    assert set(report.uncovered_domains) == set(DOMAINS)


def test_total_entries_matches_input() -> None:
    """total_entries reflects the number of RankedEntry objects passed in."""
    entries = [_make_ranked(["housing_affordability"]) for _ in range(7)]
    report = analyze_gaps("Austin, TX", entries)

    assert report.total_entries == 7


def test_covered_issue_with_three_entries() -> None:
    """An issue area with 3+ entries appears in covered_issues."""
    entries = [_make_ranked(["energy_transition"]) for _ in range(3)]
    report = analyze_gaps("Austin, TX", entries)

    assert "energy_transition" in report.covered_issues
    assert "energy_transition" not in report.missing_issues
    assert "energy_transition" not in report.thin_issues


def test_location_in_report() -> None:
    """GapReport carries the location string passed in."""
    report = analyze_gaps("Kansas City, MO", [])
    assert report.location == "Kansas City, MO"
