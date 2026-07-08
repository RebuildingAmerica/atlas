"""Pipeline orchestration for discovery runs."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from atlas_shared import (
    DiscoveryRunStats,
    DiscoveryRunStatus,
)

from atlas.domains.discovery.cost import (
    CostCeilingExceeded,
    assert_within_budget,
    estimate_llm_cost,
    estimate_search_cost,
    record_cost,
)
from atlas.domains.discovery.pipeline.deduplicator import deduplicate_entries
from atlas.domains.discovery.pipeline.extractor import extract_entries
from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.ranker import rank_entries
from atlas.domains.discovery.pipeline.source_fetcher import build_search_provider, fetch_sources
from atlas.domains.discovery.trust_gate import evaluate_publication
from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import get_db_connection

from . import runner_storage_persistence as _runner_storage_persistence
from .runner_persistence import (
    _research_gap_payloads,
    _research_lead_confidence,
    _research_lead_payload,
    _research_source_payloads,
    persist_discovery_artifacts,
    persist_discovery_results,
)
from .runner_storage import (
    _build_discovery_run_artifacts,
    _dedup_suspect_lookup,
    _fetched_source_to_page_content,
    _ranked_entry_to_shared,
    _today_iso_date,
)
from .runner_storage_artifacts import _build_page_task_outcomes, _raw_entry_to_shared
from .runner_storage_persistence import (
    _find_existing_entry,
)
from .runner_storage_persistence import (
    _upsert_entry as _storage_upsert_entry,
)

_SEARCH_PROVIDER_NAME = "brave"
_LLM_PROVIDER_NAME = "anthropic"

if TYPE_CHECKING:
    from aiosqlite import Connection

logger = logging.getLogger(__name__)

__all__ = [
    "DiscoveryPipelineCredentials",
    "DiscoveryPipelineJob",
    "_build_page_task_outcomes",
    "_find_existing_entry",
    "_raw_entry_to_shared",
    "_research_gap_payloads",
    "_research_lead_confidence",
    "_research_lead_payload",
    "_research_source_payloads",
    "_upsert_entry",
    "evaluate_publication",
    "persist_discovery_artifacts",
    "persist_discovery_results",
    "run_discovery_pipeline",
    "run_discovery_pipeline_for_run",
]


@dataclass(frozen=True)
class DiscoveryPipelineJob:
    """Inputs that define one discovery pipeline run."""

    run_id: str
    location_query: str
    state: str
    issue_areas: list[str]
    research_goal: str = "landscape_scan"


@dataclass(frozen=True)
class DiscoveryPipelineCredentials:
    """Optional service credentials used during discovery execution."""

    search_api_key: str | None = None
    anthropic_api_key: str | None = None


async def _upsert_entry(
    conn: Connection,
    entry: Any,
    *,
    score: float = 0.0,
    dedup_suspect: bool = False,
    dedup_note: str | None = None,
) -> str:
    """Compatibility wrapper for tests that patch runner-level publication gating."""
    previous_evaluator = _runner_storage_persistence.evaluate_publication
    _runner_storage_persistence.evaluate_publication = evaluate_publication
    try:
        return await _storage_upsert_entry(
            conn,
            entry,
            score=score,
            dedup_suspect=dedup_suspect,
            dedup_note=dedup_note,
        )
    finally:
        _runner_storage_persistence.evaluate_publication = previous_evaluator


async def run_discovery_pipeline(  # noqa: PLR0915
    conn: Connection,
    *,
    job: DiscoveryPipelineJob,
    credentials: DiscoveryPipelineCredentials | None = None,
    settings: Settings | None = None,
) -> None:
    """Execute the full discovery pipeline for an existing run.

    Search and model calls are metered against the cost ledger and gated by the
    configured ceilings and kill switch. Crossing a ceiling ends the run as a
    controlled stop -- the run is marked failed with a ``cost_ceiling`` reason
    rather than raising, so a budget breach never strands the worker or storms
    the logs.
    """
    active_credentials = credentials or DiscoveryPipelineCredentials()
    active_settings = settings or get_settings()
    started_at = datetime.now(UTC)
    run_id = job.run_id
    try:
        city = job.location_query.split(",", maxsplit=1)[0].strip()

        t0 = time.monotonic()
        queries = generate_queries(city=city, state=job.state, issue_areas=job.issue_areas)
        logger.info(
            "Pipeline step completed",
            extra={
                "run_id": run_id,
                "step": "query_gen",
                "count": len(queries),
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )

        t0 = time.monotonic()
        await assert_within_budget(conn, run_id=run_id, settings=active_settings)
        search_provider = build_search_provider(active_credentials.search_api_key)
        fetched_sources = await fetch_sources(queries, search_provider)
        await record_cost(
            conn,
            run_id=run_id,
            kind="search",
            provider=_SEARCH_PROVIDER_NAME,
            units=len(fetched_sources),
            estimated_cost=estimate_search_cost(len(fetched_sources)),
        )
        logger.info(
            "Pipeline step completed",
            extra={
                "run_id": run_id,
                "step": "source_fetch",
                "count": len(fetched_sources),
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )

        t0 = time.monotonic()
        extracted_entries: list[dict[str, Any]] = []
        for source in fetched_sources:
            await assert_within_budget(conn, run_id=run_id, settings=active_settings)
            source_entries = await extract_entries(
                source.url,
                source.content,
                city,
                job.state,
                active_credentials.anthropic_api_key,
            )
            await record_cost(
                conn,
                run_id=run_id,
                kind="llm",
                provider=_LLM_PROVIDER_NAME,
                units=_token_units(source.content),
                estimated_cost=estimate_llm_cost(_token_units(source.content)),
            )
            today_iso = _today_iso_date()
            for item in source_entries:
                entry_dict = item.model_dump(mode="json")
                entry_dict["source_urls"] = [source.url]
                entry_dict["source_dates"] = [source.published_date or today_iso]
                entry_dict["source_contexts"] = {source.url: item.extraction_context}
                entry_dict["last_seen"] = source.published_date or today_iso
                extracted_entries.append(entry_dict)
        logger.info(
            "Pipeline step completed",
            extra={
                "run_id": run_id,
                "step": "extraction",
                "count": len(extracted_entries),
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )

        t0 = time.monotonic()
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
        dedup_suspects = _dedup_suspect_lookup(deduped, extracted_entries, existing_entries)
        logger.info(
            "Pipeline step completed",
            extra={
                "run_id": run_id,
                "step": "dedup",
                "count": len(deduped.entries),
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )

        t0 = time.monotonic()
        source_counts = {
            entry.get("id") or entry["name"]: len(entry.get("source_urls", []))
            for entry in deduped.entries
        }
        ranked = rank_entries(deduped.entries, source_counts=source_counts)
        shared_ranked = [_ranked_entry_to_shared(entry) for entry in ranked]
        shared_sources = [_fetched_source_to_page_content(source) for source in fetched_sources]
        logger.info(
            "Pipeline step completed",
            extra={
                "run_id": run_id,
                "step": "ranking",
                "count": len(shared_ranked),
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )

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
            dedup_suspects=dedup_suspects,
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

    except CostCeilingExceeded as ceiling:
        reason = f"cost_ceiling:{ceiling.scope}"
        logger.warning("Discovery run %s halted by %s", job.run_id, reason)
        await DiscoveryRunCRUD.fail(conn, job.run_id, reason)
    except Exception as exc:
        logger.exception("Discovery run %s failed", job.run_id)
        await DiscoveryRunCRUD.fail(conn, job.run_id, str(exc))
        raise


def _token_units(content: str) -> float:
    """Estimate model token usage from source content for metering.

    Uses a coarse whitespace word count as a deterministic proxy for tokens so
    spend can be metered without round-tripping the model's usage figures.

    Parameters
    ----------
    content : str
        The source text passed to extraction.

    Returns
    -------
    float
        Estimated token units consumed by the extraction call.
    """
    return float(len(content.split()))


async def run_discovery_pipeline_for_run(
    *,
    database_url: str,
    job: DiscoveryPipelineJob,
    credentials: DiscoveryPipelineCredentials | None = None,
    settings: Settings | None = None,
) -> None:
    """Open a connection and execute a discovery run."""
    conn = await get_db_connection(database_url)
    try:
        await run_discovery_pipeline(
            conn,
            job=job,
            credentials=credentials,
            settings=settings,
        )
    finally:
        await conn.close()
