"""Tests for browser research website crawling."""

from __future__ import annotations

import json

import pytest

from atlas_scout.steps import browser_research as br

from .support import (
    _FakeBrowser,
    _FakePage,
    _FakePlaywrightContext,
    _FakeProvider,
    _entry,
    _install_fake_playwright,
    _patch_extract_page_entries,
)


@pytest.mark.asyncio
async def test_research_org_website_no_playwright_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_playwright(monkeypatch, None, raise_import_error=True)
    provider = _FakeProvider()
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
        org_name="ExampleOrg",
    )
    assert result == []


@pytest.mark.asyncio
async def test_research_org_website_full_path_extracts_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_text = "Body content describing leadership and programs. " * 60
    fake_page = _FakePage(
        links=[
            {"href": "https://example.org/team", "text": "Team"},
            {"href": "https://example.org/programs", "text": "Programs"},
        ],
        page_texts={
            "https://example.org/team": long_text,
            "https://example.org/programs": long_text,
        },
        page_titles={
            "https://example.org/team": "Team Page",
            "https://example.org/programs": "Programs Page",
        },
    )
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser)
    _install_fake_playwright(monkeypatch, fake_pw)

    extractor_calls = _patch_extract_page_entries(
        monkeypatch,
        by_url={
            "https://example.org/team": [_entry("Alice", "https://example.org/team")],
            "https://example.org/programs": [],
        },
    )

    provider = _FakeProvider(
        completion_text=json.dumps(["https://example.org/team", "https://example.org/programs"])
    )
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
        org_name="ExampleOrg",
    )
    assert len(result) == 1
    assert result[0].name == "Alice"
    assert "https://example.org/team" in extractor_calls
    assert fake_browser.closed is True


@pytest.mark.asyncio
async def test_research_org_website_skips_low_quality_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_page = _FakePage(
        links=[{"href": "https://example.org/thin", "text": "Thin"}],
        page_texts={"https://example.org/thin": "too short"},
    )
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser)
    _install_fake_playwright(monkeypatch, fake_pw)

    extractor_calls = _patch_extract_page_entries(monkeypatch)

    provider = _FakeProvider(completion_text=json.dumps(["https://example.org/thin"]))
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
    )
    assert result == []
    assert extractor_calls == []


@pytest.mark.asyncio
async def test_research_org_website_continues_when_page_visit_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_text = "Body content describing leadership and programs. " * 60
    fake_page = _FakePage(
        links=[
            {"href": "https://example.org/broken", "text": "Broken"},
            {"href": "https://example.org/good", "text": "Good"},
        ],
        page_texts={"https://example.org/good": long_text},
        page_titles={"https://example.org/good": "Good"},
        goto_failures={"https://example.org/broken"},
    )
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser)
    _install_fake_playwright(monkeypatch, fake_pw)

    _patch_extract_page_entries(
        monkeypatch,
        by_url={"https://example.org/good": [_entry("Bob", "https://example.org/good")]},
    )
    provider = _FakeProvider(
        completion_text=json.dumps(["https://example.org/broken", "https://example.org/good"])
    )
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
    )
    assert [e.name for e in result] == ["Bob"]


@pytest.mark.asyncio
async def test_research_org_website_top_level_failure_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If launching the browser fails, the outer try/except absorbs the error."""
    fake_page = _FakePage(links=[], page_texts={})
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser, launch_raises=True)
    _install_fake_playwright(monkeypatch, fake_pw)

    provider = _FakeProvider()
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
    )
    assert result == []
