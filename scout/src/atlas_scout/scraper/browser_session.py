"""Shared Playwright browser session lifecycle for Scout's browser-based fetch paths."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from playwright.async_api import Page

BROWSER_USER_AGENT = "AtlasScout/1.0 (+https://atlas.rebuildingus.org/scout)"


@asynccontextmanager
async def browser_page() -> AsyncIterator[Page]:
    """Launch a headless Chromium page with Scout's standard User-Agent.

    Raises
    ------
    ImportError
        If Playwright is not installed.
    """
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.set_extra_http_headers({"User-Agent": BROWSER_USER_AGENT})
            yield page
        finally:
            await browser.close()
