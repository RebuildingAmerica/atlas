"""Step 3 runtime orchestration for entry extraction."""

from __future__ import annotations

import asyncio
import logging
import sys
from typing import TYPE_CHECKING

from atlas_scout.pipeline_support import error_reason as _error_reason
from atlas_scout.steps.entry_extract.cache import (
    _cacheable_entry,
    _entries_from_cached,
    _extraction_cache_key,
    _page_fingerprint,
    _prompt_key,
    _provider_cache_key,
    _validate_against_source,
)
from atlas_scout.steps.entry_extract.prompt import (
    _build_system_prompt,
    _pass_enrich,
    _pass_identify,
)
from atlas_scout.steps.entry_extract.roster_tables import (
    _extract_line_delimited_roster_entries,
    _extract_member_list_entries,
    _extract_plain_text_roster_table_entries,
    _extract_roster_table_entries,
    _extract_senate_contact_entries,
    _extract_state_senate_entries,
)
from atlas_scout.steps.entry_extract.roster_utils import (
    _extract_plain_text_office_roster_entries,
    _extract_tabular_roster_entries,
)
from atlas_scout.steps.entry_extract.structured import _extract_structured_resource_entries

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from atlas_shared import PageContent, RawEntry

    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

__all__ = ["extract_entries_stream", "extract_page_entries"]

# Heuristic extractors tried in order before falling back to the LLM two-pass
# pipeline; each takes (page, city, state) and returns entries or an empty
# list. Order matters: earlier entries win when a page matches more than one
# shape (e.g. a structured resource block that also happens to look tabular).
_HEURISTIC_EXTRACTORS: tuple[
    Callable[..., list[RawEntry]],
    ...,
] = (
    _extract_structured_resource_entries,
    _extract_roster_table_entries,
    _extract_tabular_roster_entries,
    _extract_senate_contact_entries,
    _extract_member_list_entries,
    _extract_state_senate_entries,
    _extract_line_delimited_roster_entries,
    _extract_plain_text_roster_table_entries,
    _extract_plain_text_office_roster_entries,
)


def _config_value(name: str, default: float) -> float:
    """Return a live configuration override from the public entry_extract module."""
    module = sys.modules.get("atlas_scout.steps.entry_extract")
    if module is None:
        return default
    value = getattr(module, name, default)
    return float(value)


async def extract_entries_stream(
    pages: AsyncIterator[PageContent],
    provider: LLMProvider,
    city: str,
    state: str,
    *,
    store: ScoutStore | None = None,
    run_id: str | None = None,
    reuse_cached_extractions: bool = True,
    extraction_directive: str | None = None,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> AsyncIterator[RawEntry]:
    """
    Extract structured entries from page content using an LLM provider.

    Pages are processed with bounded concurrency and extraction results are
    cached by content fingerprint, prompt, and provider identity so repeated
    runs can reuse prior work.
    """
    pending: set[asyncio.Task[list[RawEntry]]] = set()

    async def _extract_page(page: PageContent) -> list[RawEntry]:
        """Run extraction for one page, using shared caches when possible."""
        return await extract_page_entries(
            page,
            provider,
            city,
            state,
            store=store,
            run_id=run_id,
            reuse_cached_extractions=reuse_cached_extractions,
            extraction_directive=extraction_directive,
            on_retry=on_retry,
        )

    async for page in pages:
        task = asyncio.create_task(_extract_page(page))
        pending.add(task)
        if len(pending) >= provider.max_concurrent:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task_done in done:
                entries = await task_done
                for entry in entries:
                    yield entry

    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task_done in done:
            entries = await task_done
            for entry in entries:
                yield entry


async def extract_page_entries(
    page: PageContent,
    provider: LLMProvider,
    city: str,
    state: str,
    *,
    store: ScoutStore | None,
    run_id: str | None,
    reuse_cached_extractions: bool,
    extraction_directive: str | None = None,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> list[RawEntry]:
    """Extract entries for a single page, using durable caches and work claims."""
    if not page.text.strip():
        return []

    claim_poll_seconds = _config_value("_CLAIM_POLL_SECONDS", 0.25)
    claim_lease_seconds = _config_value("_CLAIM_LEASE_SECONDS", 60.0)
    claim_wait_seconds = _config_value("_CLAIM_WAIT_SECONDS", 60.0)
    system_prompt = _build_system_prompt(city, state, extraction_directive=extraction_directive)
    prompt_key = _prompt_key(system_prompt)
    provider_key = _provider_cache_key(provider)
    source_fingerprint = _page_fingerprint(page)
    cache_key = _extraction_cache_key(
        source_fingerprint=source_fingerprint,
        provider_key=provider_key,
        prompt_key=prompt_key,
    )

    if store is not None and reuse_cached_extractions:
        cached = await store.get_cached_extraction(cache_key)
        if cached is not None:
            return _entries_from_cached(cached["entries"], source_url=page.url)

    if store is not None:
        claim_key = f"extract:{cache_key}"
        owner_run_id = run_id or "anonymous"
        deadline = asyncio.get_running_loop().time() + claim_wait_seconds

        while True:
            if await store.claim_work(
                claim_key,
                owner_run_id=owner_run_id,
                lease_seconds=int(claim_lease_seconds),
            ):
                return await _perform_extraction(
                    page,
                    provider,
                    city=city,
                    state=state,
                    system_prompt=system_prompt,
                    source_fingerprint=source_fingerprint,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    cache_key=cache_key,
                    store=store,
                    claim_key=claim_key,
                    on_retry=on_retry,
                )

            if reuse_cached_extractions:
                cached = await store.get_cached_extraction(cache_key)
                if cached is not None:
                    return _entries_from_cached(cached["entries"], source_url=page.url)

            claim = await store.get_work_claim(claim_key)
            if claim is None or claim.get("status") != "inflight":
                continue
            if asyncio.get_running_loop().time() >= deadline:
                logger.warning(
                    "Timed out waiting on shared extraction claim for %s; falling back to local extraction",
                    page.url,
                )
                return await _perform_unclaimed_extraction(
                    page,
                    provider,
                    city=city,
                    state=state,
                    system_prompt=system_prompt,
                    source_fingerprint=source_fingerprint,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    cache_key=cache_key,
                    store=store,
                    on_retry=on_retry,
                )
            await asyncio.sleep(claim_poll_seconds)
    return await _run_provider_extraction(
        page,
        provider,
        city=city,
        state=state,
        system_prompt=system_prompt,
        on_retry=on_retry,
    )


async def _perform_extraction(
    page: PageContent,
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    system_prompt: str,
    source_fingerprint: str,
    provider_key: str,
    prompt_key: str,
    cache_key: str,
    store: ScoutStore,
    claim_key: str,
    on_retry: Callable[[dict[str, object]], None] | None,
) -> list[RawEntry]:
    """Run provider extraction, persist the cache, and release the claim."""
    try:
        entries = await _run_provider_extraction(
            page,
            provider,
            city=city,
            state=state,
            system_prompt=system_prompt,
            on_retry=on_retry,
        )
        await store.cache_extraction(
            cache_key=cache_key,
            source_fingerprint=source_fingerprint,
            provider_key=provider_key,
            prompt_key=prompt_key,
            entries=[_cacheable_entry(entry) for entry in entries],
        )
        await store.complete_work(claim_key)
        return entries
    except Exception as exc:
        logger.warning("Extraction failed for %s: %s", page.url, _error_reason(exc))
        await store.fail_work(claim_key, _error_reason(exc))
        raise


async def _perform_unclaimed_extraction(
    page: PageContent,
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    system_prompt: str,
    source_fingerprint: str,
    provider_key: str,
    prompt_key: str,
    cache_key: str,
    store: ScoutStore,
    on_retry: Callable[[dict[str, object]], None] | None,
) -> list[RawEntry]:
    """Run extraction without owning the shared claim, then update cache opportunistically."""
    entries = await _run_provider_extraction(
        page,
        provider,
        city=city,
        state=state,
        system_prompt=system_prompt,
        on_retry=on_retry,
    )
    await store.cache_extraction(
        cache_key=cache_key,
        source_fingerprint=source_fingerprint,
        provider_key=provider_key,
        prompt_key=prompt_key,
        entries=[_cacheable_entry(entry) for entry in entries],
    )
    return entries


async def _run_provider_extraction(
    page: PageContent,
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    system_prompt: str,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> list[RawEntry]:
    """Two-pass extraction: identify entities, then enrich each one.

    Pass 1 asks a simple question: "Who and what is named in this text?"
    Pass 2 takes each identified entity and extracts structured details.

    This decomposition lets any model succeed — each call has one focused job.
    """
    for extractor in _HEURISTIC_EXTRACTORS:
        heuristic_entries = extractor(page, city=city, state=state)
        if heuristic_entries:
            return heuristic_entries

    # --- Pass 1: Identify all named entities ---
    identified = await _pass_identify(page, provider, on_retry=on_retry)
    if not identified:
        return []

    # --- Pass 2: Enrich each entity with structured details ---
    entries = await _pass_enrich(
        identified,
        page,
        provider,
        system_prompt=system_prompt,
        on_retry=on_retry,
    )
    entries = _validate_against_source(entries, page)
    page_date = page.published_date.date() if page.published_date else None
    for entry in entries:
        if city and not entry.city:
            entry.city = city
        if state and not entry.state:
            entry.state = state
        entry.source_url = page.url
        entry.source_date = page_date
    return entries
