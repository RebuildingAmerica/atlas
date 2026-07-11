"""Discovery pipeline artifact builders."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Protocol

from atlas_shared import (
    DeduplicatedEntry as SharedDeduplicatedEntry,
)
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoverySyncInfo,
    PageContent,
    PageTaskOutcome,
    RunCheckpoint,
    SourceType,
)
from atlas_shared import (
    RankedEntry as SharedRankedEntry,
)
from atlas_shared import (
    RawEntry as SharedRawEntry,
)

from atlas.domains.discovery.pipeline.gap_analyzer import analyze_gaps

from .runner_storage_persistence import _parse_date


class DiscoveryArtifactJob(Protocol):
    """Minimal run input shape needed to build persisted discovery artifacts."""

    @property
    def run_id(self) -> str: ...  # pragma: no cover

    @property
    def location_query(self) -> str: ...  # pragma: no cover

    @property
    def state(self) -> str: ...  # pragma: no cover

    @property
    def issue_areas(self) -> list[str]: ...  # pragma: no cover

    @property
    def research_goal(self) -> str: ...  # pragma: no cover


__all__ = [
    "DiscoveryArtifactJob",
    "_build_discovery_run_artifacts",
    "_build_page_task_outcomes",
    "_fetched_source_to_page_content",
    "_ranked_entry_to_shared",
    "_raw_entry_to_shared",
]


def _build_discovery_run_artifacts(  # noqa: PLR0913
    *,
    job: DiscoveryArtifactJob,
    started_at: datetime,
    completed_at: datetime,
    stats: DiscoveryRunStats,
    raw_entries: list[dict[str, Any]],
    ranked_entries: list[SharedRankedEntry],
    sources: list[PageContent],
) -> DiscoveryRunArtifacts:
    """Build the canonical artifact bundle emitted by the Atlas-triggered runner."""
    gap_report = analyze_gaps(
        job.location_query,
        [
            {
                "issue_areas": ranked_entry.entry.issue_areas,
            }
            for ranked_entry in ranked_entries
        ],
    )
    return DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-api",
            run=DiscoveryRunInput(
                location_query=job.location_query,
                state=job.state,
                issue_areas=job.issue_areas,
                research_goal=job.research_goal,
            ),
            status=stats.status,
            started_at=started_at,
            completed_at=completed_at,
            sync=DiscoverySyncInfo(
                remote_run_id=job.run_id,
                sync_status="atlas-managed",
            ),
        ),
        stats=stats,
        checkpoints=[
            RunCheckpoint(
                phase="completed",
                status=stats.status,
                metrics={
                    "queries_generated": stats.queries_generated,
                    "sources_fetched": stats.sources_fetched,
                    "entries_confirmed": stats.entries_confirmed,
                },
                created_at=completed_at,
            )
        ],
        page_tasks=_build_page_task_outcomes(sources, raw_entries),
        sources=sources,
        raw_entries=[_raw_entry_to_shared(item) for item in raw_entries],
        ranked_entries=ranked_entries,
        gap_report=gap_report,
    )


def _build_page_task_outcomes(
    sources: list[PageContent],
    raw_entries: list[dict[str, Any]],
) -> list[PageTaskOutcome]:
    """Build lightweight page outcomes for Atlas-managed runs."""
    entries_by_source: dict[str, int] = {}
    for entry in raw_entries:
        source_urls = entry.get("source_urls")
        if not isinstance(source_urls, list):
            continue
        for source_url in source_urls:
            normalized_url = str(source_url)
            entries_by_source[normalized_url] = entries_by_source.get(normalized_url, 0) + 1

    return [
        PageTaskOutcome(
            task_id=source.task_id or source.url,
            url=source.url,
            status="processed",
            entries_extracted=entries_by_source.get(source.url, 0),
            user_visible=True,
        )
        for source in sources
    ]


def _raw_entry_to_shared(entry: dict[str, Any]) -> SharedRawEntry:
    """Convert an internal extracted-entry payload into the shared raw-entry shape."""
    source_dates = entry.get("source_dates")
    source_date = None
    if isinstance(source_dates, list) and source_dates:
        source_date_value = source_dates[0]
        source_date = (
            source_date_value
            if isinstance(source_date_value, date)
            else _parse_date(str(source_date_value))
        )

    source_contexts = entry.get("source_contexts")
    source_url = str(entry.get("source_urls", [""])[0]) if entry.get("source_urls") else ""
    extraction_context = ""
    if isinstance(source_contexts, dict) and source_url:
        extraction_context = str(source_contexts.get(source_url) or "")

    return SharedRawEntry.model_validate(
        {
            "name": entry.get("name") or "",
            "entry_type": entry.get("entry_type"),
            "description": entry.get("description") or "",
            "city": entry.get("city"),
            "state": entry.get("state"),
            "geo_specificity": entry.get("geo_specificity"),
            "issue_areas": entry.get("issue_areas") or [],
            "region": entry.get("region"),
            "website": entry.get("website"),
            "email": entry.get("email"),
            "social_media": entry.get("social_media") or {},
            "affiliated_org": entry.get("affiliated_org"),
            "extraction_context": extraction_context,
            "source_url": source_url,
            "source_date": source_date,
        }
    )


def _ranked_entry_to_shared(entry: Any) -> SharedRankedEntry:
    """Convert the API ranker output into the shared RankedEntry model."""
    payload = dict(entry.entry)
    normalized_payload = {
        **payload,
        "description": payload.get("description") or "",
        "issue_areas": payload.get("issue_areas") or [],
        "social_media": payload.get("social_media") or {},
        "source_urls": payload.get("source_urls") or [],
        "source_contexts": payload.get("source_contexts") or {},
    }
    source_dates = [
        value if isinstance(value, date) else _parse_date(str(value))
        for value in payload.get("source_dates", [])
    ]
    last_seen_value = payload.get("last_seen")
    last_seen = (
        last_seen_value
        if isinstance(last_seen_value, date)
        else _parse_date(str(last_seen_value))
        if last_seen_value
        else None
    )
    shared_entry = SharedDeduplicatedEntry.model_validate(
        {
            **normalized_payload,
            "source_dates": source_dates,
            "last_seen": last_seen,
        }
    )
    return SharedRankedEntry(entry=shared_entry, score=entry.score, components=entry.components)


def _fetched_source_to_page_content(source: Any) -> PageContent:
    """Convert fetched-source metadata into the shared page/source model."""
    published_date = (
        datetime.fromisoformat(source.published_date) if source.published_date else None
    )
    return PageContent(
        url=source.url,
        title=source.title or "",
        text=source.content,
        publication=source.publication,
        published_date=published_date,
        source_type=SourceType(source.source_type),
    )
