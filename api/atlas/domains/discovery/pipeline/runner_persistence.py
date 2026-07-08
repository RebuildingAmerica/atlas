"""Discovery pipeline persistence helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas_shared import (
    DeduplicatedEntry as SharedDeduplicatedEntry,
)
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunStats,
    DiscoveryRunStatus,
    PageContent,
)
from atlas_shared import (
    RankedEntry as SharedRankedEntry,
)

from atlas.models import DiscoveryRunCRUD, SourceCRUD
from atlas.platform.database import db

from .runner_storage_persistence import (
    _page_published_date,
    _persist_issue_areas,
    _persist_sources,
    _upsert_entry,
)

if TYPE_CHECKING:
    from aiosqlite import Connection

__all__ = [
    "_build_research_summary",
    "_lead_reason",
    "_plural",
    "_research_gap_payloads",
    "_research_lead_confidence",
    "_research_lead_payload",
    "_research_reasoning_signals",
    "_research_source_payloads",
    "persist_discovery_artifacts",
    "persist_discovery_results",
]


async def persist_discovery_results(  # noqa: PLR0913
    conn: Connection,
    *,
    run_id: str,
    ranked_entries: list[SharedRankedEntry],
    sources: list[PageContent],
    stats: DiscoveryRunStats,
    dedup_suspects: dict[tuple[str, str | None], str] | None = None,
) -> tuple[list[str], int]:
    """Persist shared discovery results into Atlas tables for an existing run."""
    source_by_url = {source.url: source for source in sources}
    suspects = dedup_suspects or {}
    confirmed_entry_ids: list[str] = []
    linked_source_urls: set[str] = set()

    for ranked_entry in ranked_entries:
        dedup_note = suspects.get(
            (ranked_entry.entry.name.strip().lower(), ranked_entry.entry.city)
        )
        entry_id = await _upsert_entry(
            conn,
            ranked_entry.entry,
            score=ranked_entry.score,
            dedup_suspect=dedup_note is not None,
            dedup_note=dedup_note,
        )
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
    dedup_suspects: dict[tuple[str, str | None], str] | None = None,
) -> tuple[list[str], int]:
    """Persist a canonical discovery artifact bundle into Atlas tables."""
    confirmed_entry_ids, source_count = await persist_discovery_results(
        conn,
        run_id=run_id,
        ranked_entries=artifacts.ranked_entries,
        sources=artifacts.sources,
        stats=artifacts.stats,
        dedup_suspects=dedup_suspects,
    )
    if artifacts.stats.status == DiscoveryRunStatus.COMPLETED:
        research_summary = await _build_research_summary(
            conn,
            artifacts=artifacts,
            confirmed_entry_ids=confirmed_entry_ids,
        )
        await DiscoveryRunCRUD.update_research_summary(conn, run_id, research_summary)
    return confirmed_entry_ids, source_count


async def _build_research_summary(
    conn: Connection,
    *,
    artifacts: DiscoveryRunArtifacts,
    confirmed_entry_ids: list[str],
) -> dict[str, Any]:
    """Build source-linked research output from persisted discovery artifacts."""
    ranked_leads = [
        _research_lead_payload(ranked_entry, entry_id)
        for ranked_entry, entry_id in zip(
            artifacts.ranked_entries, confirmed_entry_ids, strict=False
        )
    ][:5]
    key_sources = await _research_source_payloads(conn, artifacts)
    gaps = _research_gap_payloads(artifacts)
    location = artifacts.manifest.run.location_query
    lead_count = len(ranked_leads)
    source_count = len(key_sources)
    return {
        "brief": (
            f"{location} returned {lead_count} ranked {_plural('lead', lead_count)} backed by "
            f"{source_count} {_plural('source', source_count)}."
        ),
        "ranked_leads": ranked_leads,
        "key_sources": key_sources,
        "gaps": gaps,
        "reasoning_signals": _research_reasoning_signals(
            ranked_leads=ranked_leads,
            key_sources=key_sources,
            gaps=gaps,
        ),
    }


def _research_lead_payload(
    ranked_entry: SharedRankedEntry,
    entry_id: str,
) -> dict[str, Any]:
    """Build the summary payload for one ranked lead."""
    entry = ranked_entry.entry
    source_count = len(set(entry.source_urls))
    latest_source_date = max(entry.source_dates).isoformat() if entry.source_dates else None
    return {
        "entry_id": entry_id,
        "name": entry.name,
        "type": str(entry.entry_type),
        "why_it_matters": _lead_reason(entry),
        "source_count": source_count,
        "confidence": _research_lead_confidence(source_count),
        "latest_source_date": latest_source_date,
    }


def _research_lead_confidence(source_count: int) -> str:
    """Return a conservative confidence state for a research lead."""
    if source_count >= 2:  # noqa: PLR2004
        return "corroborated"
    if source_count == 1:
        return "partial"
    return "unverified"


def _lead_reason(entry: SharedDeduplicatedEntry) -> str:
    """Return the most useful source-backed reason for a ranked lead."""
    for source_url in entry.source_urls:
        context = entry.source_contexts.get(source_url)
        if context:
            return context
    source_count = len(set(entry.source_urls))
    return f"Ranked from {source_count} supporting {_plural('source', source_count)}."


async def _research_source_payloads(
    conn: Connection,
    artifacts: DiscoveryRunArtifacts,
) -> list[dict[str, Any]]:
    """Build summary source payloads using persisted source IDs."""
    source_urls = {
        url for ranked_entry in artifacts.ranked_entries for url in ranked_entry.entry.source_urls
    }
    source_by_url = {source.url: source for source in artifacts.sources}
    payloads: list[dict[str, Any]] = []
    for source_url in sorted(source_urls):
        page = source_by_url.get(source_url)
        persisted = await SourceCRUD.get_by_url(conn, source_url)
        if page is None or persisted is None or not (page.title or "").strip():
            continue
        published_date = _page_published_date(page)
        payloads.append(
            {
                "source_id": persisted.id,
                "title": page.title,
                "url": page.url,
                "publication": page.publication,
                "published_date": published_date.isoformat() if published_date else None,
                "why_it_matters": "Supports one or more ranked leads.",
            }
        )
    return payloads[:5]


def _research_gap_payloads(artifacts: DiscoveryRunArtifacts) -> list[dict[str, str]]:
    """Build plain-language gap payloads from the coverage report."""
    gap_report = artifacts.gap_report
    if gap_report is None:
        return []

    gaps: list[dict[str, str]] = []
    if gap_report.missing_issues:
        gaps.append(
            {
                "label": "Missing issue coverage",
                "detail": f"No ranked leads for: {', '.join(gap_report.missing_issues)}.",
            }
        )
    if gap_report.thin_issues:
        gaps.append(
            {
                "label": "Thin issue coverage",
                "detail": f"Limited lead coverage for: {', '.join(gap_report.thin_issues)}.",
            }
        )
    if gap_report.uncovered_domains:
        gaps.append(
            {
                "label": "Uncovered domains",
                "detail": f"No source-backed leads in: {', '.join(gap_report.uncovered_domains)}.",
            }
        )
    return gaps


def _research_reasoning_signals(
    *,
    ranked_leads: list[dict[str, Any]],
    key_sources: list[dict[str, Any]],
    gaps: list[dict[str, str]],
) -> list[str]:
    """Build concise signals explaining why the research output is inspectable."""
    signals = [
        f"Ranked {len(ranked_leads)} {_plural('lead', len(ranked_leads))}.",
        f"Linked {len(key_sources)} key {_plural('source', len(key_sources))}.",
    ]
    if gaps:
        signals.append(f"Flagged {len(gaps)} {_plural('gap', len(gaps))}.")
    return signals


def _plural(word: str, count: int) -> str:
    """Return a simple English plural for count-aware labels."""
    return word if count == 1 else f"{word}s"
