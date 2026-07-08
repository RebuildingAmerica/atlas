"""Article-backlog recovery helpers for the Scout pipeline."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_shared import PageContent

from atlas_scout.article_backlog import article_page_from_record
from atlas_scout.steps.entry_extract import (
    _build_system_prompt,
    _prompt_key,
    _provider_cache_key,
    extract_page_entries,
)

if TYPE_CHECKING:
    from atlas_scout.pipeline_state import PipelineState

_ARTICLE_BACKLOG_BATCH_LIMIT = 500
_ARTICLE_EXTRACTION_LEASE_SECONDS = 600
_DEFAULT_LOCATION_TARGET_COUNT = 250


def extraction_identity(
    provider: object,
    *,
    city: str,
    state: str,
    extraction_directive: str | None = None,
) -> tuple[str, str]:
    """Return the provider/prompt identity used by extraction caching."""
    system_prompt = _build_system_prompt(city, state, extraction_directive=extraction_directive)
    return _provider_cache_key(provider), _prompt_key(system_prompt)


def effective_target_count(*, target_count: int | None, direct_mode: bool) -> int | None:
    """Return the entry target for this run, if one should bound discovery."""
    if target_count is not None and target_count > 0:
        return target_count
    if direct_mode:
        return None
    return _DEFAULT_LOCATION_TARGET_COUNT


def article_backlog_claim_limit(*, target_count: int | None, current_entries: int) -> int:
    """Return how many article rows to claim for the next recovery batch."""
    if target_count is None:
        return _ARTICLE_BACKLOG_BATCH_LIMIT
    remaining = max(target_count - current_entries, 0)
    if remaining <= 0:
        return 0
    return min(_ARTICLE_BACKLOG_BATCH_LIMIT, remaining)


async def refetch_article_page(fetcher: object, article_url: str) -> PageContent | None:
    """Fetch an article page when the stored article row lacks usable text."""
    fetch = getattr(fetcher, "fetch", None)
    if not callable(fetch):
        return None
    page = await fetch(article_url)
    return page if isinstance(page, PageContent) else None


async def process_article_backlog(state: PipelineState) -> int:
    """Recover article pages from the backlog and extract them."""
    if state.direct_urls:
        return 0

    provider_key, prompt_key = extraction_identity(
        state.provider,
        city=state.city,
        state=state.state,
        extraction_directive=state.extraction_directive,
    )
    processed = 0
    while not state.target_reached():
        claim_limit = article_backlog_claim_limit(
            target_count=state.effective_target_count,
            current_entries=len(state.raw_entries),
        )
        article_rows = await state.store.claim_article_extraction_batch(
            owner_run_id=state.run_id,
            provider_key=provider_key,
            prompt_key=prompt_key,
            limit=claim_limit,
            lease_seconds=_ARTICLE_EXTRACTION_LEASE_SECONDS,
            retry_failed=not state.reuse_cached_extractions,
        )
        if not article_rows:
            return processed

        for article in article_rows:
            if state.target_reached():
                return processed
            article_url = str(article.get("url") or "")
            if not article_url:
                continue
            task_id = await state.store.create_page_task(state.run_id, article_url)
            state.page_outcomes_by_task[task_id] = {
                "task_id": task_id,
                "url": article_url,
                "depth": 0,
                "status": "queued",
                "error": None,
                "entries": 0,
                "user_visible": True,
            }
            state.visible_page_tasks.add(task_id)
            state.emit(
                "page_found",
                {
                    "url": article_url,
                    "depth": 0,
                    "task_id": task_id,
                },
            )

            page = article_page_from_record(article)
            if page is None:
                page = await refetch_article_page(state.fetcher, article_url)
            if page is None:
                reason = "article_text_unavailable"
                await state.store.update_page_task(task_id, "fetch_failed", error=reason)
                state.page_outcomes_by_task[task_id].update(status="fetch_failed", error=reason)
                await state.store.fail_article_extraction(
                    article_url=article_url,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    error=reason,
                )
                continue

            page = page.model_copy(update={"task_id": task_id})
            state.fetched_pages_by_url[page.url] = page
            state.stats["pages_fetched"] += 1
            processed += 1
            await state.store.update_page_task(task_id, "extracting")
            state.page_outcomes_by_task[task_id]["status"] = "extracting"
            try:
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
            except Exception as exc:
                reason = str(exc)
                await state.store.update_page_task(task_id, "extract_failed", error=reason)
                state.page_outcomes_by_task[task_id].update(status="extract_failed", error=reason)
                await state.store.fail_article_extraction(
                    article_url=article_url,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    error=reason,
                )
                state.emit(
                    "extract_failed",
                    {
                        "url": article_url,
                        "task_id": task_id,
                        "reason": reason,
                    },
                )
                continue

            state.raw_entries.extend(entries)
            status = "extracted" if entries else "extract_empty"
            await state.store.update_page_task(task_id, status, entries_extracted=len(entries))
            state.page_outcomes_by_task[task_id].update(status=status, entries=len(entries))
            await state.store.complete_article_extraction(
                article_url=article_url,
                provider_key=provider_key,
                prompt_key=prompt_key,
                entries_extracted=len(entries),
            )
            state.emit(
                "extract_completed" if entries else "extract_empty",
                {
                    "url": article_url,
                    "task_id": task_id,
                    "entries": len(entries),
                },
            )
            for entry in entries:
                state.emit(
                    "entity_found",
                    {
                        "url": article_url,
                        "task_id": task_id,
                        "name": entry.name,
                        "entry_type": str(entry.entry_type),
                    },
                )

    return processed
