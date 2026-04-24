"""Pipeline orchestration for discovery runs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas_shared import (
    DeduplicatedEntry as SharedDeduplicatedEntry,
)
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunStatus,
    DiscoverySyncInfo,
    PageContent,
    PageTaskOutcome,
    RunCheckpoint,
    SourceType,
)
from atlas_shared import (
    GapReport as SharedGapReport,
)
from atlas_shared import (
    RankedEntry as SharedRankedEntry,
)
from atlas_shared import (
    RawEntry as SharedRawEntry,
)

from atlas.domains.discovery.pipeline.deduplicator import deduplicate_entries
from atlas.domains.discovery.pipeline.extractor import extract_entries
from atlas.domains.discovery.pipeline.gap_analyzer import analyze_gaps
from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.ranker import rank_entries
from atlas.domains.discovery.pipeline.source_fetcher import fetch_sources
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD
from atlas.platform.database import db, get_db_connection

if TYPE_CHECKING:
    from aiosqlite import Connection

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DiscoveryPipelineJob:
    """Inputs that define one discovery pipeline run."""

    run_id: str
    location_query: str
    state: str
    issue_areas: list[str]


@dataclass(frozen=True)
class DiscoveryPipelineCredentials:
    """Optional service credentials used during discovery execution."""

    search_api_key: str | None = None
    anthropic_api_key: str | None = None


async def run_discovery_pipeline(
    conn: Connection,
    *,
    job: DiscoveryPipelineJob,
    credentials: DiscoveryPipelineCredentials | None = None,
) -> None:
    """Execute the full discovery pipeline for an existing run."""
    active_credentials = credentials or DiscoveryPipelineCredentials()
    started_at = datetime.now(UTC)
    try:
        city = job.location_query.split(",", maxsplit=1)[0].strip()
        queries = generate_queries(city=city, state=job.state, issue_areas=job.issue_areas)
        fetched_sources = await fetch_sources(queries, active_credentials.search_api_key)

        extracted_entries: list[dict[str, Any]] = []

        for source in fetched_sources:
            source_entries = await extract_entries(
                source.url,
                source.content,
                city,
                job.state,
                active_credentials.anthropic_api_key,
            )
            today_iso = _today_iso_date()
            extracted_entries.extend(
                {
                    "name": item.name,
                    "entry_type": item.entry_type,
                    "description": item.description,
                    "city": item.city,
                    "state": item.state,
                    "region": item.region,
                    "geo_specificity": item.geo_specificity,
                    "issue_areas": sorted(set(item.issue_areas)),
                    "website": item.website,
                    "email": item.email,
                    "social_media": item.social_media,
                    "affiliated_org": item.affiliated_org,
                    "source_urls": [source.url],
                    "source_dates": [source.published_date or today_iso],
                    "source_contexts": {source.url: item.extraction_context},
                    "last_seen": source.published_date or today_iso,
                }
                for item in source_entries
            )

        existing_entries = [
            {
                **entry.to_dict(),
                "entry_type": entry.type,
                "issue_areas": await EntryCRUD.get_issue_areas(conn, entry.id),
            }
            for entry in await EntryCRUD.list(
                conn,
                state=job.state,
                city=city,
                active_only=False,
                limit=1000,
            )
        ]
        deduped = deduplicate_entries(extracted_entries, existing_entries)

        source_counts = {
            entry.get("id") or entry["name"]: len(entry.get("source_urls", []))
            for entry in deduped.entries
        }
        ranked = rank_entries(deduped.entries, source_counts=source_counts)
        shared_ranked = [_ranked_entry_to_shared(entry) for entry in ranked]
        shared_sources = [_fetched_source_to_page_content(source) for source in fetched_sources]

        stats = DiscoveryRunStats(
            queries_generated=len(queries),
            sources_fetched=len(fetched_sources),
            sources_processed=len(fetched_sources),
            entries_extracted=len(extracted_entries),
            entries_after_dedup=len(deduped.entries),
            entries_confirmed=len(shared_ranked),
            status=DiscoveryRunStatus.COMPLETED,
        )
        artifacts = _build_discovery_run_artifacts(
            job=job,
            started_at=started_at,
            completed_at=datetime.now(UTC),
            stats=stats,
            raw_entries=extracted_entries,
            ranked_entries=shared_ranked,
            sources=shared_sources,
        )
        confirmed_entry_ids, _sources_persisted = await persist_discovery_artifacts(
            conn,
            run_id=job.run_id,
            artifacts=artifacts,
        )
        confirmed_entries_visible = 0
        for entry_id in confirmed_entry_ids:
            entry = await EntryCRUD.get_by_id(conn, entry_id)
            if entry is not None:
                confirmed_entries_visible += 1

        gap_report = artifacts.gap_report
        logger.info(
            "Discovery run %s completed with %s entries and %s uncovered domains",
            job.run_id,
            confirmed_entries_visible,
            len(gap_report.uncovered_domains) if gap_report else 0,
        )
        if confirmed_entries_visible != len(confirmed_entry_ids):
            await DiscoveryRunCRUD.update(
                conn,
                job.run_id,
                entries_confirmed=confirmed_entries_visible,
            )

    except Exception as exc:
        logger.exception("Discovery run %s failed", job.run_id)
        await DiscoveryRunCRUD.fail(conn, job.run_id, str(exc))
        raise


async def run_discovery_pipeline_for_run(
    *,
    database_url: str,
    job: DiscoveryPipelineJob,
    credentials: DiscoveryPipelineCredentials | None = None,
) -> None:
    """Open a connection and execute a discovery run."""
    conn = await get_db_connection(database_url)
    try:
        await run_discovery_pipeline(
            conn,
            job=job,
            credentials=credentials,
        )
    finally:
        await conn.close()


async def persist_discovery_results(
    conn: Connection,
    *,
    run_id: str,
    ranked_entries: list[SharedRankedEntry],
    sources: list[PageContent],
    stats: DiscoveryRunStats,
) -> tuple[list[str], int]:
    """Persist shared discovery results into Atlas tables for an existing run."""
    source_by_url = {source.url: source for source in sources}
    confirmed_entry_ids: list[str] = []
    linked_source_urls: set[str] = set()

    for ranked_entry in ranked_entries:
        entry_id = await _upsert_entry(conn, ranked_entry.entry)
        confirmed_entry_ids.append(entry_id)
        await _persist_issue_areas(conn, entry_id, ranked_entry.entry.issue_areas)
        linked_source_urls.update(
            await _persist_sources(
                conn,
                entry_id=entry_id,
                entry=ranked_entry.entry,
                source_by_url=source_by_url,
            )
        )

    final_entries_confirmed = stats.entries_confirmed or len(confirmed_entry_ids)
    final_sources_processed = (
        stats.sources_processed or stats.sources_fetched or len(linked_source_urls)
    )

    if stats.status == DiscoveryRunStatus.COMPLETED:
        await DiscoveryRunCRUD.complete(
            conn,
            run_id,
            queries_generated=stats.queries_generated,
            sources_fetched=stats.sources_fetched,
            sources_processed=final_sources_processed,
            entries_extracted=stats.entries_extracted,
            entries_after_dedup=stats.entries_after_dedup,
            entries_confirmed=final_entries_confirmed,
        )
    else:
        await DiscoveryRunCRUD.update(
            conn,
            run_id,
            status=stats.status.value,
            completed_at=db.now_iso(),
            queries_generated=stats.queries_generated,
            sources_fetched=stats.sources_fetched,
            sources_processed=final_sources_processed,
            entries_extracted=stats.entries_extracted,
            entries_after_dedup=stats.entries_after_dedup,
            entries_confirmed=final_entries_confirmed,
            error_message=stats.error_message,
        )

    return confirmed_entry_ids, len(linked_source_urls)


async def persist_discovery_artifacts(
    conn: Connection,
    *,
    run_id: str,
    artifacts: DiscoveryRunArtifacts,
) -> tuple[list[str], int]:
    """Persist a canonical discovery artifact bundle into Atlas tables."""
    return await persist_discovery_results(
        conn,
        run_id=run_id,
        ranked_entries=artifacts.ranked_entries,
        sources=artifacts.sources,
        stats=artifacts.stats,
    )


async def _upsert_entry(conn: Connection, entry: SharedDeduplicatedEntry) -> str:
    """Create or update an entry based on exact location/type/name matching."""
    city = entry.city
    state = entry.state
    candidates = await EntryCRUD.list(conn, state=state, city=city, active_only=False, limit=500)
    match = next(
        (
            candidate
            for candidate in candidates
            if candidate.type == str(entry.entry_type)
            and candidate.name.strip().lower() == entry.name.strip().lower()
        ),
        None,
    )

    if match is None:
        today_iso = _today_iso_date()
        return await EntryCRUD.create(
            conn,
            entry_type=str(entry.entry_type),
            name=entry.name,
            description=entry.description,
            city=city,
            state=state,
            geo_specificity=str(entry.geo_specificity),
            region=entry.region,
            website=entry.website,
            email=entry.email,
            social_media=entry.social_media,
            first_seen=_first_seen_for_entry(entry, today_iso),
            last_seen=entry.last_seen or _parse_date(today_iso),
        )

    today_iso = _today_iso_date()
    await EntryCRUD.update(
        conn,
        match.id,
        description=entry.description,
        region=entry.region,
        website=entry.website or match.website,
        email=entry.email or match.email,
        social_media=entry.social_media or match.social_media,
        last_seen=entry.last_seen or _parse_date(today_iso),
    )
    return match.id


async def _persist_issue_areas(conn: Connection, entry_id: str, issue_areas: list[str]) -> None:
    """Ensure issue area links exist for an entry."""
    for issue_area in sorted(set(issue_areas)):
        await conn.execute(
            """
            INSERT OR IGNORE INTO entry_issue_areas (entry_id, issue_area, created_at)
            VALUES (?, ?, datetime('now'))
            """,
            (entry_id, issue_area),
        )
    await conn.commit()


async def _persist_sources(
    conn: Connection,
    *,
    entry_id: str,
    entry: SharedDeduplicatedEntry,
    source_by_url: dict[str, PageContent],
) -> set[str]:
    """Create/link sources for an entry."""
    linked_source_urls: set[str] = set()
    for source_url in sorted(set(entry.source_urls)):
        source = source_by_url.get(
            source_url,
            PageContent(url=source_url, source_type=SourceType.ORG_WEBSITE),
        )
        existing = await SourceCRUD.get_by_url(conn, source_url)
        if existing is None:
            source_id = await SourceCRUD.create(
                conn,
                url=source.url,
                source_type=str(source.source_type),
                extraction_method="autodiscovery",
                title=source.title,
                publication=source.publication,
                published_date=_page_published_date(source),
                raw_content=source.text or None,
            )
        else:
            source_id = existing.id
            await SourceCRUD.update(
                conn,
                source_id,
                title=source.title or existing.title,
                publication=source.publication or existing.publication,
                published_date=_page_published_date(source) or existing.published_date,
                raw_content=source.text or existing.raw_content,
            )
        await SourceCRUD.link_to_entry(
            conn,
            entry_id,
            source_id,
            extraction_context=entry.source_contexts.get(source_url),
        )
        linked_source_urls.add(source_url)
    return linked_source_urls


def _parse_date(value: str) -> date:
    """Parse an ISO date string into a date."""
    return date.fromisoformat(value)


def _today_iso_date() -> str:
    """Return the current UTC calendar date as an ISO string."""
    return datetime.now(UTC).date().isoformat()


def _first_seen_for_entry(entry: SharedDeduplicatedEntry, today_iso: str) -> date:
    """Return the earliest available source date for a deduplicated entry."""
    if entry.source_dates:
        return min(entry.source_dates)
    return _parse_date(today_iso)


def _page_published_date(page: PageContent) -> date | None:
    """Convert a page timestamp to the source-table published date shape."""
    if page.published_date is None:
        return None
    return page.published_date.date()


def _build_discovery_run_artifacts(  # noqa: PLR0913
    *,
    job: DiscoveryPipelineJob,
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
        gap_report=SharedGapReport(
            location=gap_report.location,
            total_entries=gap_report.total_entries,
            covered_issues=[gap.issue_area_slug for gap in gap_report.covered_issues],
            missing_issues=[gap.issue_area_slug for gap in gap_report.missing_issues],
            thin_issues=[gap.issue_area_slug for gap in gap_report.thin_issues],
            uncovered_domains=gap_report.uncovered_domains,
        ),
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
