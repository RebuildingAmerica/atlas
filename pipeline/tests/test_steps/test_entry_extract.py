"""Tests for Step 3: entry_extract."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import (
    _build_system_prompt,
    _strip_code_fence,
    extract_entries_stream,
    extract_page_entries,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class _MockProvider:
    """A minimal LLM provider mock for testing."""

    def __init__(self, response_text: str = "[]", max_concurrent: int = 4) -> None:
        self._response_text = response_text
        self.max_concurrent = max_concurrent
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        _response_schema: Any = None,
    ) -> Completion:
        self.calls.append(messages)
        return Completion(text=self._response_text)


def _make_entry_json(name: str = "Test Org", issue: str = "housing_affordability") -> str:
    return json.dumps(
        [
            {
                "name": name,
                "type": "organization",
                "description": "A local housing org.",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": [issue],
                "affiliated_org": None,
                "website": "https://testorg.org",
                "email": "info@testorg.org",
                "social_media": {},
                "extraction_context": "Test org helps with housing.",
            }
        ]
    )


async def _pages_iter(*pages: PageContent) -> AsyncIterator[PageContent]:
    for page in pages:
        yield page


@pytest.mark.asyncio
async def test_builds_extraction_prompt_with_taxonomy() -> None:
    """The system prompt contains issue area slugs from the taxonomy."""
    prompt = _build_system_prompt("Austin", "TX")
    assert "housing_affordability" in prompt
    assert "union_organizing" in prompt
    assert "Austin, TX" in prompt


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
    page = PageContent(url="https://example.com", text="Fenced Org is a local housing organization in Austin.", title="")
    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].name == "Fenced Org"


@pytest.mark.asyncio
async def test_multiple_pages_all_extracted() -> None:
    """Entries from multiple pages are all yielded."""
    provider = _MockProvider(response_text=_make_entry_json())
    pages = [
        PageContent(url=f"https://example.com/page{i}", text="Test Org provides housing assistance in Austin TX.", title="")
        for i in range(3)
    ]

    entries = [e async for e in extract_entries_stream(_pages_iter(*pages), provider, "Austin", "TX")]

    assert len(entries) == 3
    source_urls = {e.source_url for e in entries}
    assert source_urls == {p.url for p in pages}


@pytest.mark.asyncio
async def test_reuses_cached_extraction_for_same_content(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Cached Org"))
    page = PageContent(url="https://example.com/a", text="Cached Org does housing advocacy. Shared body " * 40, title="Same title")

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
    page_one = PageContent(url="https://example.com/a", text="Shared Org provides housing services. Shared body " * 40, title="Same title")
    page_two = PageContent(url="https://example.com/b", text="Shared Org provides housing services. Shared body " * 40, title="Same title")

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
    page = PageContent(url="https://example.com/a", text="Refreshed Org serves the Austin housing community. Shared body " * 40, title="Same title")

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

    # 2 calls per run × 2 runs (refresh bypasses cache) = 4
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
    page = PageContent(url="https://example.com", text="Fallback Org organizes housing support. Shared body " * 40, title="Same title")

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
