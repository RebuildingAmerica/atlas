"""API adapter around the shared discovery-engine coverage primitives."""

from dataclasses import dataclass

from atlas_discovery_engine import summarize_issue_counts

__all__ = ["CoverageGap", "GapReport", "analyze_gaps"]

_COVERED_THRESHOLD = 3
_THIN_THRESHOLD = 1


@dataclass(frozen=True)
class CoverageGap:
    """A gap in issue area coverage."""

    issue_area_slug: str
    issue_area_name: str
    entry_count: int
    severity: str


@dataclass(frozen=True)
class GapReport:
    """Full gap analysis for a location."""

    location: str
    total_entries: int
    covered_issues: list[CoverageGap]
    missing_issues: list[CoverageGap]
    thin_issues: list[CoverageGap]
    uncovered_domains: list[str]


def analyze_gaps(location: str, confirmed_entries: list[dict[str, object]]) -> GapReport:
    """Build API-style gap-report objects from shared coverage primitives."""
    issue_counts: dict[str, int] = {}
    for entry in confirmed_entries:
        issue_areas = entry.get("issue_areas")
        if not isinstance(issue_areas, list) or not issue_areas:
            continue
        for issue_slug in issue_areas:
            issue_counts[str(issue_slug)] = issue_counts.get(str(issue_slug), 0) + 1

    summary = summarize_issue_counts(issue_counts)

    def make_gap(slug: str) -> CoverageGap:
        count = summary.issue_counts.get(slug, 0)
        severity = (
            "covered"
            if count >= _COVERED_THRESHOLD
            else ("thin" if count == _THIN_THRESHOLD else "critical")
        )
        return CoverageGap(
            issue_area_slug=slug,
            issue_area_name=summary.issue_names[slug],
            entry_count=count,
            severity=severity,
        )

    return GapReport(
        location=location,
        total_entries=len(confirmed_entries),
        covered_issues=[make_gap(slug) for slug in summary.covered_slugs],
        missing_issues=[make_gap(slug) for slug in summary.missing_slugs],
        thin_issues=[make_gap(slug) for slug in summary.thin_slugs],
        uncovered_domains=summary.uncovered_domains,
    )
