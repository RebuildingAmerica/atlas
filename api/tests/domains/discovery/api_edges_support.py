"""Shared helpers for discovery API edge-case tests."""

from __future__ import annotations

from types import SimpleNamespace

from atlas_shared import (
    DeduplicatedEntry,
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunSyncRequest,
    DiscoverySyncInfo,
    PageContent,
    RankedEntry,
)

from atlas.domains.access.principals import AuthenticatedActor

DB_BOOM_ERROR = "db boom"
EXPECTED_TWO_RUNS = 2


def _fake_run(run_id: str, *, state: str = "MO") -> SimpleNamespace:
    return SimpleNamespace(
        id=run_id,
        location_query="Kansas City, MO",
        state=state,
        research_goal="landscape_scan",
        issue_areas=["housing_affordability"],
        queries_generated=0,
        sources_fetched=0,
        sources_processed=0,
        entries_extracted=0,
        entries_after_dedup=0,
        entries_confirmed=0,
        started_at="2026-01-01T00:00:00Z",
        completed_at=None,
        status="running",
        error_message=None,
        created_at="2026-01-01T00:00:00Z",
    )


def _local_actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )


def _bundle(
    *,
    local_run_id: str = "local_xyz",
    remote_run_id: str | None = None,
) -> DiscoveryRunSyncRequest:
    """Build a minimal sync bundle reusable across edge tests."""
    return DiscoveryRunSyncRequest(
        artifacts=DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Wichita, KS",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(
                    local_run_id=local_run_id,
                    remote_run_id=remote_run_id,
                    sync_status="ready",
                ),
            ),
            stats=DiscoveryRunStats(
                queries_generated=1,
                sources_fetched=0,
                sources_processed=0,
                entries_extracted=0,
                entries_after_dedup=0,
                entries_confirmed=0,
            ),
            sources=[],
            ranked_entries=[],
        )
    )


def _bundle_with_ranked_entry(*, local_run_id: str = "local_with_entry") -> DiscoveryRunSyncRequest:
    """Build a sync bundle with one source-backed ranked lead."""
    return DiscoveryRunSyncRequest(
        artifacts=DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run=DiscoveryRunInput(
                    location_query="Wichita, KS",
                    state="KS",
                    issue_areas=["worker_cooperatives"],
                ),
                status="completed",
                sync=DiscoverySyncInfo(local_run_id=local_run_id, sync_status="ready"),
            ),
            stats=DiscoveryRunStats(
                queries_generated=1,
                sources_fetched=1,
                sources_processed=1,
                entries_extracted=1,
                entries_after_dedup=1,
                entries_confirmed=1,
            ),
            sources=[
                PageContent(
                    url="https://example.com/co-op",
                    title="Prairie workers launch co-op",
                    text="Prairie Workers Cooperative opened in Wichita.",
                )
            ],
            ranked_entries=[
                RankedEntry(
                    entry=DeduplicatedEntry(
                        name="Prairie Workers Cooperative",
                        entry_type="organization",
                        description="Worker-owned cooperative in Wichita.",
                        city="Wichita",
                        state="KS",
                        issue_areas=["worker_cooperatives"],
                        source_urls=["https://example.com/co-op"],
                        source_contexts={
                            "https://example.com/co-op": (
                                "Prairie Workers Cooperative opened in Wichita."
                            )
                        },
                    ),
                    score=0.91,
                )
            ],
        )
    )
