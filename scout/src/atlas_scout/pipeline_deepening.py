"""Iterative deepening helpers for the Scout pipeline."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_scout.pipeline_fetch_support import iter_items
from atlas_scout.pipeline_support import normalize_url
from atlas_scout.steps import browser_research, entity_chase, source_fetch
from atlas_scout.steps.discovery_engine_adapters import deduplicate_stream, rank_entries_stream
from atlas_scout.steps.entry_extract import extract_page_entries
from atlas_scout.steps.gap_analysis import analyze_gaps
from atlas_scout.steps.source_fetch import results_per_query_for_depth

if TYPE_CHECKING:
    from atlas_scout.pipeline_state import PipelineState


async def run_iterative_deepening(state: PipelineState) -> None:
    """Run the optional iterative-deepening branch after the initial crawl."""
    if not state.iterative_deepening or state.direct_urls:
        return

    state.set_phase("deepening")

    async def claim_new_url(candidate: str) -> str | None:
        normalized = normalize_url(candidate)
        if not normalized or normalized in state.seen_urls:
            return None
        state.seen_urls.add(normalized)
        return normalized

    async def fetch_and_extract(url: str) -> None:
        page = await state.fetcher.fetch(url)
        if page is None:
            return
        state.fetched_pages_by_url[page.url] = page
        state.stats["pages_fetched"] += 1
        entries = await extract_page_entries(
            page,
            state.provider,
            state.city,
            state.state,
            store=state.store,
            run_id=state.run_id,
            reuse_cached_extractions=state.reuse_cached_extractions,
            extraction_directive=state.extraction_directive,
        )
        if entries:
            state.raw_entries.extend(entries)

    preliminary_deduped = [
        entry async for entry in deduplicate_stream(iter_items(state.raw_entries))
    ]
    preliminary_ranked = [
        ranked
        async for ranked in rank_entries_stream(
            iter_items(preliminary_deduped), min_score=state.min_entry_score
        )
    ]
    preliminary_gaps = analyze_gaps(state.location, preliminary_ranked)

    all_leads: list[str] = []
    for entry in state.raw_entries:
        for lead in getattr(entry, "discovery_leads", []):
            claimed = await claim_new_url(lead)
            if claimed:
                all_leads.append(claimed)

    if all_leads:
        state.emit("status", {"phase": "following_leads", "lead_count": len(all_leads)})
        for url in all_leads[:50]:
            await fetch_and_extract(url)

    assert state.search_api_key, "iterative deepening requires a non-empty search key"
    state.emit("status", {"phase": "llm_query_gen"})
    followup_queries = await entity_chase.generate_followup_queries(
        state.provider,
        location=state.location,
        issues=state.issues,
        gap_report=preliminary_gaps,
        existing_entries=preliminary_ranked,
    )
    if followup_queries:
        state.queries_count += len(followup_queries)
        state.emit(
            "status",
            {
                "phase": "deepening_search",
                "followup_queries": len(followup_queries),
            },
        )
        deeper_rpq = results_per_query_for_depth("deep")
        deeper_results = await source_fetch.search_brave(
            [q.query for q in followup_queries],
            state.search_api_key,
            results_per_query=deeper_rpq,
        )
        for result in deeper_results:
            result_url = result.get("url")
            if isinstance(result_url, str) and result_url:
                claimed = await claim_new_url(result_url)
                if claimed:
                    await fetch_and_extract(claimed)

    state.emit("status", {"phase": "entity_chasing"})
    chase_deduped = [entry async for entry in deduplicate_stream(iter_items(state.raw_entries))]
    chase_ranked = [
        ranked
        async for ranked in rank_entries_stream(
            iter_items(chase_deduped), min_score=state.min_entry_score
        )
    ]
    chase_targets = await entity_chase.select_entities_to_chase(
        state.provider,
        entries=chase_ranked,
    )
    for target in chase_targets:
        target_url = target.get("website", "")
        if target_url:
            claimed = await claim_new_url(target_url)
            if claimed:
                await fetch_and_extract(claimed)

        search_query = target.get("search_query", "")
        if search_query and state.search_api_key:
            chase_results = await source_fetch.search_brave(
                [search_query],
                state.search_api_key,
                results_per_query=5,
            )
            for result in chase_results:
                result_url = result.get("url")
                if isinstance(result_url, str) and result_url:
                    claimed = await claim_new_url(result_url)
                    if claimed:
                        await fetch_and_extract(claimed)

    browser_targets = [
        target
        for target in chase_targets
        if target.get("website") and normalize_url(target["website"])
    ][:5]
    if browser_targets:
        state.emit("status", {"phase": "browser_research", "targets": len(browser_targets)})
        for target in browser_targets:
            target_url = target["website"]
            org_name = target.get("name", "")
            browser_entries = await browser_research.research_org_website(
                target_url,
                provider=state.provider,
                city=state.city,
                state=state.state,
                org_name=org_name,
            )
            if browser_entries:
                state.raw_entries.extend(browser_entries)
                state.emit(
                    "status",
                    {
                        "phase": "browser_research_complete",
                        "org": org_name,
                        "entries": len(browser_entries),
                    },
                )
