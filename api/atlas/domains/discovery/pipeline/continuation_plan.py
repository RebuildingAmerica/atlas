"""Freeze existing whole-run ranking before publishing resumable web units."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas_shared import DiscoveryRunArtifacts, DiscoveryRunStats
from pydantic import BaseModel

from atlas.models import EntryCRUD

from .deduplicator import deduplicate_entries
from .ranker import rank_entries
from .runner_storage_artifacts import (
    _build_discovery_run_artifacts,
    _fetched_source_to_page_content,
    _ranked_entry_to_shared,
)
from .runner_storage_persistence import _dedup_suspect_lookup

if TYPE_CHECKING:
    from aiosqlite import Connection

    from .registry_stage import RegistryDiscovery
    from .runner import DiscoveryPipelineJob
    from .web_checkpoints import WebDiscovery


class PublicationPlan(BaseModel):
    """Frozen original ranking and duplicate signals for exact receipt replay."""

    artifacts: DiscoveryRunArtifacts
    dedup_notes: list[str | None]


async def prepare_publication_plan(
    conn: Connection, job: DiscoveryPipelineJob, web: WebDiscovery, registry: RegistryDiscovery
) -> PublicationPlan:
    """Use the existing catalog comparison, ranking and research artifact rules.

    This remains one whole-run CPU unit, including the existing 1,000-catalog-row
    comparison cap. It is not a hosted CPU or memory acceptance claim.
    """
    city = job.location_query.split(",", maxsplit=1)[0].strip()
    existing = [
        {
            **entry.to_dict(),
            "entry_type": entry.type,
            "issue_areas": await EntryCRUD.get_issue_areas(conn, entry.id),
        }
        for entry in await EntryCRUD.list(
            conn, state=job.state, city=city, active_only=False, limit=1000
        )
    ]
    deduped = deduplicate_entries(web.entries, existing)
    suspects = _dedup_suspect_lookup(deduped, web.entries, existing)
    source_counts = {
        entry.get("id") or entry["name"]: len(entry.get("source_urls", []))
        for entry in deduped.entries
    }
    ranked = [
        _ranked_entry_to_shared(entry)
        for entry in rank_entries(deduped.entries, source_counts=source_counts)
    ]
    stats = DiscoveryRunStats(
        queries_generated=len(web.queries),
        sources_fetched=len(web.sources),
        sources_processed=len(web.sources),
        entries_extracted=len(web.entries) + registry.mention_count,
        entries_after_dedup=len(deduped.entries) + registry.mention_count,
        entries_confirmed=len(ranked) + registry.mention_count,
    )
    artifacts = _build_discovery_run_artifacts(
        job=job,
        started_at=web.started_at,
        completed_at=datetime.now(UTC),
        stats=stats,
        raw_entries=web.entries,
        ranked_entries=ranked,
        sources=[_fetched_source_to_page_content(source) for source in web.sources],
    )
    if web.page_tasks is not None:
        artifacts.page_tasks = web.page_tasks
    return PublicationPlan(
        artifacts=artifacts,
        dedup_notes=[
            suspects.get((entry.entry.name.strip().lower(), entry.entry.city)) for entry in ranked
        ],
    )
