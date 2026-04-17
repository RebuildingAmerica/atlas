"""Pipeline orchestration for discovery runs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas.domains.discovery.pipeline.deduplicator import deduplicate_entries
from atlas.domains.discovery.pipeline.extractor import extract_entries
from atlas.domains.discovery.pipeline.gap_analyzer import analyze_gaps
from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.ranker import rank_entries
from atlas.domains.discovery.pipeline.source_fetcher import fetch_sources
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD
from atlas.platform.database import get_db_connection

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
    try:
        city = job.location_query.split(",", maxsplit=1)[0].strip()
        queries = generate_queries(city=city, state=job.state, issue_areas=job.issue_areas)
        fetched_sources = await fetch_sources(queries, active_credentials.search_api_key)

        extracted_entries: list[dict[str, Any]] = []
        source_by_url = {source.url: source for source in fetched_sources}

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

        confirmed_entry_ids: list[str] = []
        for ranked_entry in ranked:
            entry_id = await _upsert_entry(conn, ranked_entry.entry)
            confirmed_entry_ids.append(entry_id)
            await _persist_issue_areas(conn, entry_id, ranked_entry.entry.get("issue_areas", []))
            await _persist_sources(
                conn,
                entry_id=entry_id,
                source_urls=ranked_entry.entry.get("source_urls", []),
                source_contexts=ranked_entry.entry.get("source_contexts", {}),
                source_by_url=source_by_url,
            )

        confirmed_entries = []
        for entry_id in confirmed_entry_ids:
            entry = await EntryCRUD.get_by_id(conn, entry_id)
            if entry is not None:
                confirmed_entries.append(
                    {
                        **entry.to_dict(),
                        "issue_areas": await EntryCRUD.get_issue_areas(conn, entry_id),
                    }
                )
        gap_report = analyze_gaps(job.location_query, confirmed_entries)
        logger.info(
            "Discovery run %s completed with %s entries and %s uncovered domains",
            job.run_id,
            len(confirmed_entries),
            len(gap_report.uncovered_domains),
        )

        await DiscoveryRunCRUD.complete(
            conn,
            job.run_id,
            queries_generated=len(queries),
            sources_fetched=len(fetched_sources),
            sources_processed=len(fetched_sources),
            entries_extracted=len(extracted_entries),
            entries_after_dedup=len(deduped.entries),
            entries_confirmed=len(confirmed_entries),
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


async def _upsert_entry(conn: Connection, entry: dict[str, Any]) -> str:
    """Create or update an entry based on exact location/type/name matching."""
    city = entry.get("city")
    state = entry.get("state")
    candidates = await EntryCRUD.list(conn, state=state, city=city, active_only=False, limit=500)
    match = next(
        (
            candidate
            for candidate in candidates
            if candidate.type == entry["entry_type"]
            and candidate.name.strip().lower() == entry["name"].strip().lower()
        ),
        None,
    )

    if match is None:
        today_iso = _today_iso_date()
        return await EntryCRUD.create(
            conn,
            entry_type=entry["entry_type"],
            name=entry["name"],
            description=entry["description"],
            city=city,
            state=state,
            geo_specificity=entry["geo_specificity"],
            region=entry.get("region"),
            website=entry.get("website"),
            email=entry.get("email"),
            social_media=entry.get("social_media"),
            first_seen=_parse_date(min(entry.get("source_dates", [today_iso]))),
            last_seen=_parse_date(entry.get("last_seen") or today_iso),
        )

    today_iso = _today_iso_date()
    await EntryCRUD.update(
        conn,
        match.id,
        description=entry["description"],
        region=entry.get("region"),
        website=entry.get("website") or match.website,
        email=entry.get("email") or match.email,
        social_media=entry.get("social_media") or match.social_media,
        last_seen=_parse_date(entry.get("last_seen") or today_iso),
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
    source_urls: list[str],
    source_contexts: dict[str, str | None],
    source_by_url: dict[str, Any],
) -> None:
    """Create/link sources for an entry."""
    for source_url in sorted(set(source_urls)):
        source = source_by_url[source_url]
        existing = await SourceCRUD.get_by_url(conn, source_url)
        source_id = (
            existing.id
            if existing
            else await SourceCRUD.create(
                conn,
                url=source.url,
                source_type=source.source_type,
                extraction_method="autodiscovery",
                title=source.title,
                publication=source.publication,
                published_date=_parse_date(source.published_date)
                if source.published_date
                else None,
                raw_content=source.content,
            )
        )
        await SourceCRUD.link_to_entry(
            conn,
            entry_id,
            source_id,
            extraction_context=source_contexts.get(source_url),
        )


def _parse_date(value: str) -> date:
    """Parse an ISO date string into a date."""
    return date.fromisoformat(value)


def _today_iso_date() -> str:
    """Return the current UTC calendar date as an ISO string."""
    return datetime.now(UTC).date().isoformat()
