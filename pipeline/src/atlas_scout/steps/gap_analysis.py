"""
Step 6: Gap Analysis.

Identifies missing and thin issue area coverage for a location.
"""

from __future__ import annotations

from atlas_shared import DOMAINS, ISSUE_AREAS_BY_DOMAIN, GapReport, RankedEntry

__all__ = ["analyze_gaps"]

# Coverage thresholds
_COVERED_THRESHOLD = 3
_THIN_THRESHOLD = 1


def analyze_gaps(location: str, entries: list[RankedEntry]) -> GapReport:
    """
    Analyze coverage gaps for a location.

    Parameters
    ----------
    location : str
        Location string (e.g., "Kansas City, MO").
    entries : list[RankedEntry]
        Ranked entries to analyse.

    Returns
    -------
    GapReport
        Coverage gap report for the location.
    """
    # Count entries per issue area
    issue_counts: dict[str, int] = {}
    for ranked in entries:
        for issue in ranked.entry.issue_areas:
            issue_counts[issue] = issue_counts.get(issue, 0) + 1

    # Collect all known issue area slugs
    all_issues: dict[str, str] = {}  # slug → name
    for domain in DOMAINS:
        for issue in ISSUE_AREAS_BY_DOMAIN[domain]:
            all_issues[issue.slug] = issue.name

    covered_slugs: list[str] = []
    missing_slugs: list[str] = []
    thin_slugs: list[str] = []

    for slug in all_issues:
        count = issue_counts.get(slug, 0)
        if count == 0:
            missing_slugs.append(slug)
        elif count < _COVERED_THRESHOLD:
            thin_slugs.append(slug)
        else:
            covered_slugs.append(slug)

    # Find domains with no coverage at all
    uncovered_domains = [
        domain
        for domain in DOMAINS
        if not any(issue_counts.get(issue.slug, 0) > 0 for issue in ISSUE_AREAS_BY_DOMAIN[domain])
    ]

    return GapReport(
        location=location,
        total_entries=len(entries),
        covered_issues=covered_slugs,
        missing_issues=missing_slugs,
        thin_issues=thin_slugs,
        uncovered_domains=uncovered_domains,
    )
