"""API adapter around the shared discovery-engine coverage primitives."""

from atlas_discovery_engine import summarize_issue_counts
from atlas_shared import GapReport

__all__ = ["GapReport", "analyze_gaps"]


def analyze_gaps(location: str, confirmed_entries: list[dict[str, object]]) -> GapReport:
    """Build a shared GapReport from confirmed entry dicts."""
    issue_counts: dict[str, int] = {}
    for entry in confirmed_entries:
        issue_areas = entry.get("issue_areas")
        if not isinstance(issue_areas, list) or not issue_areas:
            continue
        for issue_slug in issue_areas:
            issue_counts[str(issue_slug)] = issue_counts.get(str(issue_slug), 0) + 1

    summary = summarize_issue_counts(issue_counts)

    return GapReport(
        location=location,
        total_entries=len(confirmed_entries),
        covered_issues=list(summary.covered_slugs),
        missing_issues=list(summary.missing_slugs),
        thin_issues=list(summary.thin_slugs),
        uncovered_domains=summary.uncovered_domains,
    )
