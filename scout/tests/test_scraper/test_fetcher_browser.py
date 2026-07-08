"""Browser fallback behavior tests for atlas_scout.scraper.fetcher.AsyncFetcher."""

from __future__ import annotations

from typing import Any

import httpx
import pytest  # noqa: TC002
import respx
from atlas_shared import PageContent, SourceType

from atlas_scout.scraper import fetcher as fetcher_module
from atlas_scout.scraper.extractor import ContentExtraction
from atlas_scout.scraper.fetcher import AsyncFetcher

from .fetcher_support import (
    rendered_news_page,
    rendered_roster_page,
    sparse_roster_html,
    sparse_roster_page,
)


@respx.mock
async def test_fetch_filtered_when_extraction_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    from atlas_scout.scraper import extractor as extractor_module

    monkeypatch.setattr(extractor_module.trafilatura, "extract", lambda _html, **_: None)
    respx.get("https://example.com/empty").mock(
        return_value=httpx.Response(200, text="<html><body><p>x</p></body></html>")
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/empty")
    await fetcher.close()
    assert result is None


@respx.mock
async def test_fetch_uses_browser_fallback_for_news_app_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """High-value JS-heavy news pages should get one bounded browser render pass."""
    calls: list[str] = []

    async def fake_render(url: str, *, timeout_ms: int) -> ContentExtraction:
        calls.append(f"{url}:{timeout_ms}")
        return ContentExtraction(
            page=rendered_news_page(),
            reason=None,
            discovered_links=rendered_news_page().discovered_links,
        )

    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    respx.get("https://news.example.com/local/civic-story").mock(
        return_value=httpx.Response(200, text=sparse_roster_html())
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
        browser_render_timeout_ms=1234,
    )
    result = await fetcher.fetch("https://news.example.com/local/civic-story")
    await fetcher.close()
    assert result is not None
    assert result.text == rendered_news_page().text
    assert result.discovered_links == ["https://news.example.com/local/follow-up"]
    assert calls == ["https://news.example.com/local/civic-story:1234"]


@respx.mock
async def test_fetch_uses_browser_fallback_for_sparse_civic_roster(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Civic rosters that lose rendered names should get a bounded browser pass."""
    calls: list[str] = []

    def fake_extract(_html: str, *, url: str) -> ContentExtraction:
        del url
        return ContentExtraction(page=sparse_roster_page(), reason=None, discovered_links=[])

    async def fake_render(url: str, *, timeout_ms: int) -> ContentExtraction:
        calls.append(f"{url}:{timeout_ms}")
        return ContentExtraction(
            page=rendered_roster_page(),
            reason=None,
            discovered_links=rendered_roster_page().discovered_links,
        )

    monkeypatch.setattr(fetcher_module, "extract_content_verbose", fake_extract)
    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    respx.get("https://example.gov/government/mayor-city-council").mock(
        return_value=httpx.Response(200, text="<html><body>shell</body></html>")
    )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
        browser_render_timeout_ms=1234,
    )
    result = await fetcher.fetch("https://example.gov/government/mayor-city-council")
    await fetcher.close()
    assert result is not None
    assert "Shelley Berkley" in result.text
    assert result.discovered_links == ["https://example.gov/government/mayor"]
    assert calls == ["https://example.gov/government/mayor-city-council:1234"]


@respx.mock
async def test_fetch_skips_browser_fallback_for_low_value_thin_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Thin ordinary pages should not burn browser CPU."""

    async def fake_render(url: str, *, timeout_ms: int) -> Any:
        raise AssertionError(f"unexpected browser render for {url}:{timeout_ms}")

    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    respx.get("https://example.com/tiny").mock(
        return_value=httpx.Response(200, text="<html><body><p>tiny</p></body></html>")
    )

    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, browser_fallback_enabled=True)
    result = await fetcher.fetch("https://example.com/tiny")
    await fetcher.close()
    assert result is None


@respx.mock
async def test_fetch_browser_fallback_respects_per_fetcher_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Browser rendering should be capped so a run cannot spend unbounded CPU."""
    calls: list[str] = []

    async def fake_render(url: str, *, timeout_ms: int) -> ContentExtraction:
        del timeout_ms
        calls.append(url)
        return ContentExtraction(
            page=PageContent(
                url=url,
                text="Rendered civic article body. " * 80,
                title="Rendered",
                source_type=SourceType.NEWS_ARTICLE,
            ),
            reason=None,
            discovered_links=[],
        )

    monkeypatch.setattr(fetcher_module, "render_url_with_browser", fake_render)
    for suffix in ("one", "two"):
        respx.get(f"https://news.example.com/local/{suffix}").mock(
            return_value=httpx.Response(
                200,
                text="<html><body><div id='__next'></div><script></script></body></html>",
            )
        )

    fetcher = AsyncFetcher(
        max_concurrent=5,
        request_delay_ms=0,
        browser_fallback_enabled=True,
        max_browser_renders_per_run=1,
    )
    first = await fetcher.fetch("https://news.example.com/local/one")
    second = await fetcher.fetch("https://news.example.com/local/two")
    await fetcher.close()
    assert first is not None
    assert second is None
    assert calls == ["https://news.example.com/local/one"]
