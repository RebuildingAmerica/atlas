"""Scout adapter around the shared discovery-engine coverage primitives."""

from atlas_discovery_engine import summarize_issue_counts
from atlas_shared import GapReport, RankedEntry

__all__ = ["analyze_gaps"]


def analyze_gaps(location: str, entries: list[RankedEntry]) -> GapReport:
    """Build the shared GapReport from ranked entries using shared coverage primitives."""
    issue_counts: dict[str, int] = {}
    for ranked in entries:
        for issue in ranked.entry.issue_areas:
            issue_counts[issue] = issue_counts.get(issue, 0) + 1

    summary = summarize_issue_counts(issue_counts)
    return GapReport(
        location=location,
        total_entries=len(entries),
        covered_issues=summary.covered_slugs,
        missing_issues=summary.missing_slugs,
        thin_issues=summary.thin_slugs,
        uncovered_domains=summary.uncovered_domains,
    )
