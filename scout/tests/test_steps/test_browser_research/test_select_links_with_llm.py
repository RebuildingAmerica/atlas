"""Tests for browser research link selection."""

from __future__ import annotations

from atlas_scout.steps import browser_research as br

from .support import _FakeProvider


async def test_select_links_with_llm_empty_input() -> None:
    provider = _FakeProvider()
    result = await br._select_links_with_llm([], provider, org_name="Org", max_links=5)
    assert result == []


async def test_select_links_with_llm_dedupes_and_returns_picks() -> None:
    provider = _FakeProvider(completion_text='["https://example.com/team"]')
    links = [
        {"href": "https://example.com/team", "text": "Team"},
        {"href": "https://example.com/team", "text": "duplicate"},
        {"href": "https://example.com/about", "text": "About"},
    ]
    result = await br._select_links_with_llm(links, provider, org_name="Org", max_links=5)
    assert result == ["https://example.com/team"]


async def test_select_links_with_llm_skips_links_without_href() -> None:
    provider = _FakeProvider(completion_text="[]")
    links: list[dict[str, str]] = [{"href": "", "text": "empty"}]
    result = await br._select_links_with_llm(links, provider, org_name="Org", max_links=5)
    assert result == []


async def test_select_links_with_llm_handles_provider_exception() -> None:
    provider = _FakeProvider(raise_exc=RuntimeError("boom"))
    links = [{"href": "https://example.com/team", "text": "Team"}]
    result = await br._select_links_with_llm(links, provider, org_name="", max_links=5)
    assert result == []
