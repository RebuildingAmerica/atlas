"""Tests for Step 3: entry_extract."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_scout.providers.base import Completion
from atlas_scout.steps.entry_extract import (
    _build_system_prompt,
    _provider_cache_key,
    _strip_code_fence,
    extract_entries_stream,
    extract_page_entries,
)

from .test_entry_extract import (
    _make_entry_json,
    _make_entry_json_without_location,
    _MockProvider,
    _pages_iter,
)


@pytest.mark.asyncio
async def test_builds_extraction_prompt_with_taxonomy() -> None:
    """The system prompt contains issue area slugs from the taxonomy."""
    prompt = _build_system_prompt("Austin", "TX")
    assert "housing_affordability" in prompt
    assert "union_organizing" in prompt
    assert "Austin, TX" in prompt
    assert "actual proper name" in prompt
    assert "Councilman Ward 1" in prompt


@pytest.mark.asyncio
async def test_builds_direct_url_prompt_that_allows_location_inference() -> None:
    """When location is omitted, the prompt should instruct the model to infer it."""
    prompt = _build_system_prompt("", "")
    assert "Infer the primary geography from the source text" in prompt
    assert "Target location:" not in prompt


@pytest.mark.asyncio
async def test_extracts_entries_from_pages() -> None:
    """extract_entries_stream yields RawEntry objects for each extracted item."""
    provider = _MockProvider(response_text=_make_entry_json("Housing First ATX"))
    page = PageContent(url="https://example.com", text="Housing First ATX helps renters.", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].name == "Housing First ATX"
    assert entries[0].source_url == "https://example.com"
    assert isinstance(entries[0], RawEntry)


@pytest.mark.asyncio
async def test_extracts_entries_fill_target_location_when_model_omits_it() -> None:
    """Target location should keep source-backed entries place-aware."""
    provider = _MockProvider(response_text=_make_entry_json_without_location("Jane Doe"))
    page = PageContent(url="https://example.com", text="Jane Doe serves the city.", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Dallas", "TX")]

    assert len(entries) == 1
    assert entries[0].city == "Dallas"
    assert entries[0].state == "TX"


@pytest.mark.asyncio
async def test_skips_empty_llm_results() -> None:
    """Entries are not produced when LLM returns empty JSON array."""
    provider = _MockProvider(response_text="[]")
    page = PageContent(url="https://example.com", text="Some content.", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert entries == []


@pytest.mark.asyncio
async def test_skips_empty_page_text() -> None:
    """Pages with empty text are skipped and produce no LLM calls."""
    provider = _MockProvider(response_text=_make_entry_json())
    page = PageContent(url="https://example.com", text="   ", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert entries == []
    assert provider.calls == []  # No LLM call made


@pytest.mark.asyncio
async def test_strips_code_fences() -> None:
    """Code-fenced JSON responses are parsed correctly."""
    fenced = "```json\n" + _make_entry_json("Fenced Org") + "\n```"
    assert _strip_code_fence(fenced) == _make_entry_json("Fenced Org")

    provider = _MockProvider(response_text=fenced)
    page = PageContent(
        url="https://example.com",
        text="Fenced Org is a local housing organization in Austin.",
        title="",
    )
    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].name == "Fenced Org"


@pytest.mark.asyncio
async def test_multiple_pages_all_extracted() -> None:
    """Entries from multiple pages are all yielded."""
    provider = _MockProvider(response_text=_make_entry_json())
    pages = [
        PageContent(
            url=f"https://example.com/page{i}",
            text="Test Org provides housing assistance in Austin TX.",
            title="",
        )
        for i in range(3)
    ]

    entries = [
        e async for e in extract_entries_stream(_pages_iter(*pages), provider, "Austin", "TX")
    ]

    assert len(entries) == 3
    source_urls = {e.source_url for e in entries}
    assert source_urls == {p.url for p in pages}


@pytest.mark.asyncio
async def test_reuses_cached_extraction_for_same_content(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Cached Org"))
    page = PageContent(
        url="https://example.com/a",
        text="Cached Org does housing advocacy. Shared body " * 40,
        title="Same title",
    )

    first_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]
    second_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]

    await store.close()

    assert len(first_entries) == 1
    assert len(second_entries) == 1
    # Two-pass extraction: identify + enrich = 2 calls on first run, 0 on cached second run
    first_run_calls = len(provider.calls)
    assert first_run_calls == 2


@pytest.mark.asyncio
async def test_cached_extraction_is_reused_across_urls_with_same_content(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Shared Org"))
    page_one = PageContent(
        url="https://example.com/a",
        text="Shared Org provides housing services. Shared body " * 40,
        title="Same title",
    )
    page_two = PageContent(
        url="https://example.com/b",
        text="Shared Org provides housing services. Shared body " * 40,
        title="Same title",
    )

    first_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page_one),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]
    second_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page_two),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]

    await store.close()

    # Two-pass extraction: 2 calls for first page, 0 for cached second page
    assert len(provider.calls) == 2
    assert first_entries[0].source_url == "https://example.com/a"
    assert second_entries[0].source_url == "https://example.com/b"


@pytest.mark.asyncio
async def test_refresh_extractions_bypasses_cache(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Refreshed Org"))
    page = PageContent(
        url="https://example.com/a",
        text="Refreshed Org serves the Austin housing community. Shared body " * 40,
        title="Same title",
    )

    _ = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]
    _ = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
            reuse_cached_extractions=False,
        )
    ]

    await store.close()

    # 2 calls per run x 2 runs (refresh bypasses cache) = 4
    assert len(provider.calls) == 4


@pytest.mark.asyncio
async def test_claim_wait_timeout_falls_back_to_local_extraction(monkeypatch) -> None:
    from atlas_scout.steps import entry_extract as entry_extract_module

    class _WaitingStore:
        async def get_cached_extraction(self, _cache_key):
            return None

        async def claim_work(self, *_args, **_kwargs):
            return False

        async def get_work_claim(self, _claim_key):
            return {"status": "inflight"}

        async def cache_extraction(self, **_kwargs):
            return None

        async def complete_work(self, _claim_key):
            return None

        async def fail_work(self, _claim_key, _error):
            return None

    monkeypatch.setattr(entry_extract_module, "_CLAIM_WAIT_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_CLAIM_POLL_SECONDS", 0.0)

    provider = _MockProvider(response_text=_make_entry_json("Fallback Org"))
    page = PageContent(
        url="https://example.com",
        text="Fallback Org organizes housing support. Shared body " * 40,
        title="Same title",
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Austin",
        "TX",
        store=_WaitingStore(),
        run_id="run-1",
        reuse_cached_extractions=True,
    )

    assert len(entries) == 1
    assert entries[0].name == "Fallback Org"
    # Two-pass extraction: identify + enrich = 2 calls
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_extract_entries_stream_saturates_concurrency_window() -> None:
    """When pending tasks reach max_concurrent, drain at least once mid-loop."""
    provider = _MockProvider(response_text=_make_entry_json("X"), max_concurrent=2)
    pages = [
        PageContent(
            url=f"https://example.com/p{i}",
            text=f"X is an org doing housing in Austin. body {i} " * 20,
            title="t",
        )
        for i in range(5)
    ]

    entries = [
        e async for e in extract_entries_stream(_pages_iter(*pages), provider, "Austin", "TX")
    ]

    assert len(entries) == 5


@pytest.mark.asyncio
async def test_pass_identify_includes_structured_metadata_block() -> None:
    """Pages with structured_data prepend a metadata block to the user message."""
    provider = _MockProvider(response_text=_make_entry_json("Meta Org"))
    page = PageContent(
        url="https://example.com/meta",
        text="Meta Org is a housing nonprofit in Austin TX.",
        title="t",
        structured_data={"author": "Jane Doe", "section": "housing"},
        published_date=datetime(2026, 1, 15, tzinfo=UTC),
    )

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].source_date is not None
    user_msg = provider.calls[0][1].content
    assert "Page metadata" in user_msg


def test_build_system_prompt_appends_extraction_directive() -> None:
    """An operator directive is appended verbatim to the system prompt."""
    prompt = _build_system_prompt(
        "Austin",
        "TX",
        extraction_directive="  prefer education orgs  ",
    )
    assert "Operator directive:\nprefer education orgs" in prompt


class _ProviderWithModelAttr:
    max_concurrent = 1

    def __init__(self, model: str) -> None:
        self.model = model

    async def complete(self, *_args, **_kwargs):  # pragma: no cover - not used
        return Completion(text="[]")


def test_provider_cache_key_uses_model_attribute() -> None:
    """When cache_identity is missing, the model attribute composes the key."""
    key = _provider_cache_key(_ProviderWithModelAttr(model="gpt-x"))
    assert key == "_providerwithmodelattr:gpt-x"
