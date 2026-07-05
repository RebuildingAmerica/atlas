"""Bounded browser rendering fallback for JavaScript-heavy pages."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

from atlas_shared import PageContent, SourceType

from atlas_scout.scraper.crawler import extract_links
from atlas_scout.scraper.extractor import ContentExtraction, content_quality_reason

logger = logging.getLogger(__name__)

__all__ = ["render_url_with_browser"]


async def render_url_with_browser(url: str, *, timeout_ms: int) -> ContentExtraction:
    """Render a URL in Chromium and return extracted body text and links.

    Parameters
    ----------
    url : str
        URL to render.
    timeout_ms : int
        Playwright navigation timeout in milliseconds.

    Returns
    -------
    ContentExtraction
        Rendered page content, or a structured reason when browser rendering is unavailable
    or the rendered content is still too thin.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ContentExtraction(
            page=None,
            reason="browser_render_unavailable",
            discovered_links=[],
        )

    browser = None
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.set_extra_http_headers(
                {"User-Agent": "AtlasScout/1.0 (+https://atlas.rebuildingus.org/scout)"}
            )
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            await page.wait_for_timeout(750)
            text = await page.evaluate("() => document.body?.innerText || ''")
            html = await page.content()
            title = await page.title()
    except Exception:
        logger.debug("Browser render failed for %s", url, exc_info=True)
        return ContentExtraction(
            page=None,
            reason="browser_render_failed",
            discovered_links=[],
        )
    finally:
        if browser is not None:
            await browser.close()

    discovered_links = extract_links(html, base_url=url, same_domain=True)
    quality_reason = content_quality_reason(text)
    if quality_reason is not None:
        return ContentExtraction(
            page=None,
            reason=f"browser_{quality_reason}",
            discovered_links=discovered_links,
        )

    return ContentExtraction(
        page=PageContent(
            url=url,
            text=text,
            title=title,
            source_type=_source_type_for_rendered_url(url),
            discovered_links=discovered_links,
            structured_data=_browser_render_metadata(),
        ),
        reason=None,
        discovered_links=discovered_links,
    )


def _source_type_for_rendered_url(url: str) -> SourceType:
    """Infer a coarse source type for rendered pages without parsing structured data."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.lower()
    if "news" in domain or "/news/" in path:
        return SourceType.NEWS_ARTICLE
    return SourceType.WEBSITE


def _browser_render_metadata() -> dict[str, Any]:
    """Return structured metadata marking browser-rendered page text."""
    return {"render_mode": "browser"}
