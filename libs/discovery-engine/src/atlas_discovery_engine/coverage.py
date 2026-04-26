"""Shared coverage and gap-analysis primitives."""

from __future__ import annotations

from dataclasses import dataclass

from atlas_shared import DOMAINS, ISSUE_AREAS_BY_DOMAIN

__all__ = ["CoverageSummary", "summarize_issue_counts"]

_COVERED_THRESHOLD = 3


@dataclass(frozen=True)
class CoverageSummary:
    """Canonical issue-area coverage summary."""

    covered_slugs: list[str]
    missing_slugs: list[str]
    thin_slugs: list[str]
    uncovered_domains: list[str]
    issue_counts: dict[str, int]
    issue_names: dict[str, str]


def summarize_issue_counts(issue_counts: dict[str, int]) -> CoverageSummary:
    """Turn raw issue counts into covered/missing/thin coverage buckets."""
    issue_names = {
        issue.slug: issue.name
        for domain in DOMAINS
        for issue in ISSUE_AREAS_BY_DOMAIN[domain]
    }

    covered_slugs: list[str] = []
    missing_slugs: list[str] = []
    thin_slugs: list[str] = []

    for slug in issue_names:
        count = issue_counts.get(slug, 0)
        if count == 0:
            missing_slugs.append(slug)
        elif count < _COVERED_THRESHOLD:
            thin_slugs.append(slug)
        else:
            covered_slugs.append(slug)

    uncovered_domains = [
        domain
        for domain in DOMAINS
        if not any(issue_counts.get(issue.slug, 0) > 0 for issue in ISSUE_AREAS_BY_DOMAIN[domain])
    ]

    return CoverageSummary(
        covered_slugs=covered_slugs,
        missing_slugs=missing_slugs,
        thin_slugs=thin_slugs,
        uncovered_domains=uncovered_domains,
        issue_counts=issue_counts,
        issue_names=issue_names,
    )
