"""Tests for Step 3: entry_extract."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock

import pytest

from atlas_shared import PageContent, RawEntry
from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import (
    _build_system_prompt,
    _strip_code_fence,
    extract_entries_stream,
)


class _MockProvider:
    """A minimal LLM provider mock for testing."""

    def __init__(self, response_text: str = "[]", max_concurrent: int = 4) -> None:
        self._response_text = response_text
        self.max_concurrent = max_concurrent
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        response_schema: Any = None,
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
    page = PageContent(url="https://example.com", text="Some content about housing.", title="")
    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].name == "Fenced Org"


@pytest.mark.asyncio
async def test_multiple_pages_all_extracted() -> None:
    """Entries from multiple pages are all yielded."""
    provider = _MockProvider(response_text=_make_entry_json())
    pages = [
        PageContent(url=f"https://example.com/page{i}", text="Content about housing here.", title="")
        for i in range(3)
    ]

    entries = [e async for e in extract_entries_stream(_pages_iter(*pages), provider, "Austin", "TX")]

    assert len(entries) == 3
    source_urls = {e.source_url for e in entries}
    assert source_urls == {p.url for p in pages}
