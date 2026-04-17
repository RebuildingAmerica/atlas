"""
Step 6: Gap Analysis.

Identifies missing issue area coverage for a location.
"""

from dataclasses import dataclass

from atlas.domains.catalog.taxonomy import DOMAINS, ISSUE_AREAS_BY_DOMAIN

__all__ = ["CoverageGap", "GapReport", "analyze_gaps"]

# Coverage thresholds
COVERED_THRESHOLD = 3
THIN_THRESHOLD = 1


@dataclass
class CoverageGap:
    """A gap in issue area coverage."""

    issue_area_slug: str
    """Issue area slug."""

    issue_area_name: str
    """Issue area display name."""

    entry_count: int
    """Number of entries covering this issue area."""

    severity: str
    """Gap severity: 'critical' (0), 'thin' (1), 'covered' (3+)."""


@dataclass
class GapReport:
    """Full gap analysis for a location."""

    location: str
    """Location (e.g., 'Kansas City, MO')."""

    total_entries: int
    """Total confirmed entries."""

    covered_issues: list[CoverageGap]
    """Issues with coverage."""

    missing_issues: list[CoverageGap]
    """Issues with no coverage."""

    thin_issues: list[CoverageGap]
    """Issues with only 1 entry."""

    uncovered_domains: list[str]
    """Entire domains with no coverage."""


def analyze_gaps(
    location: str,
    confirmed_entries: list[dict[str, str]],
) -> GapReport:
    """
    Analyze coverage gaps for a location.

    Parameters
    ----------
    location : str
        Location (e.g., 'Kansas City, MO').
    confirmed_entries : list[dict[str, str]]
        Confirmed entries with issue_areas list.

    Returns
    -------
    GapReport
        Gap analysis for the location.

    Notes
    -----
    Reports:
    - Issue areas with zero entries
    - Issue areas with only 1 entry (thin coverage)
    - Issue areas with 3+ entries (strong coverage)
    - Entire domains with no coverage
    """
    # Count entries by issue area
    issue_counts: dict[str, int] = {}
    for entry in confirmed_entries:
        if "issue_areas" in entry:
            for issue_slug in entry["issue_areas"]:
                issue_counts[issue_slug] = issue_counts.get(issue_slug, 0) + 1

    # Categorize gaps
    covered: list[CoverageGap] = []
    missing: list[CoverageGap] = []
    thin: list[CoverageGap] = []

    # Get all issue areas from taxonomy
    all_issues = {}
    for domain in DOMAINS:
        for issue in ISSUE_AREAS_BY_DOMAIN[domain]:
            all_issues[issue.slug] = issue

    for slug, issue in all_issues.items():
        count = issue_counts.get(slug, 0)
        gap = CoverageGap(
            issue_area_slug=slug,
            issue_area_name=issue.name,
            entry_count=count,
            severity="covered"
            if count >= COVERED_THRESHOLD
            else ("thin" if count == THIN_THRESHOLD else "critical"),
        )

        if count == 0:
            missing.append(gap)
        elif count == THIN_THRESHOLD:
            thin.append(gap)
        else:
            covered.append(gap)

    # Find uncovered domains
    uncovered_domains = [
        domain
        for domain in DOMAINS
        if not any(issue_counts.get(issue.slug, 0) > 0 for issue in ISSUE_AREAS_BY_DOMAIN[domain])
    ]

    return GapReport(
        location=location,
        total_entries=len(confirmed_entries),
        covered_issues=covered,
        missing_issues=missing,
        thin_issues=thin,
        uncovered_domains=uncovered_domains,
    )
