"""Shared payloads for submit-route budget tests."""

from __future__ import annotations

from atlas_shared import (
    DeduplicatedEntry,
    DiscoveryContributionRequest,
    DiscoveryRunInput,
    DiscoveryRunStats,
    RankedEntry,
)


def make_contribution_request() -> DiscoveryContributionRequest:
    """Build a minimal, valid contributed discovery payload.

    Returns
    -------
    DiscoveryContributionRequest
        One confirmed entry with a single source context, enough to persist.
    """
    return DiscoveryContributionRequest(
        run=DiscoveryRunInput(
            location_query="Garden City, KS",
            state="KS",
            issue_areas=["worker_cooperatives"],
        ),
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=1,
            sources_processed=1,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
        ),
        sources=[],
        ranked_entries=[
            RankedEntry(
                entry=DeduplicatedEntry(
                    name="Prairie Workers Cooperative",
                    entry_type="organization",
                    description="Worker-owned cooperative in southwest Kansas.",
                    city="Garden City",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                    source_urls=["https://example.com/story"],
                    source_contexts={
                        "https://example.com/story": (
                            "Prairie Workers Cooperative opened a new facility."
                        )
                    },
                ),
                score=0.88,
            )
        ],
    )
