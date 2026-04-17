"""
Browser-based research for high-value organization websites.

Uses Playwright to navigate org websites and an LLM to decide which
pages to visit and extract people, programs, and partners.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from atlas_shared import PageContent, RawEntry, SourceType

from atlas_scout.providers.base import Completion, Message
from atlas_scout.scraper.extractor import content_quality_reason

if TYPE_CHECKING:
    from atlas_scout.providers.base import LLMProvider

logger = logging.getLogger(__name__)

__all__ = ["research_org_website"]

_MAX_PAGES = 10


async def research_org_website(
    website_url: str,
    *,
    provider: LLMProvider,
    city: str,
    state: str,
    org_name: str = "",
) -> list[RawEntry]:
    """Navigate an org website with a headless browser, extracting entities from key pages.

    Uses the LLM to select which links to follow — no hardcoded keyword lists.
    Falls back gracefully if Playwright is not installed.
    """
    try:
        from playwright.async_api import async_playwright  # noqa: PLC0415
    except ImportError:
        logger.debug("Playwright not installed — skipping browser research for %s", website_url)
        return []

    from atlas_scout.steps.entry_extract import extract_page_entries  # noqa: PLC0415

    all_entries: list[RawEntry] = []
    pages_visited = 0

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.set_extra_http_headers({"User-Agent": "AtlasScout/1.0"})

                await page.goto(website_url, wait_until="domcontentloaded", timeout=15000)

                # Extract all links from homepage
                links = await page.evaluate("""
                    () => Array.from(document.querySelectorAll('a[href]'))
                        .map(a => ({ href: a.href, text: (a.textContent || '').trim() }))
                        .filter(l => l.href.startsWith('http'))
                """)

                # Ask the LLM which links to follow
                target_urls = await _select_links_with_llm(
                    links, provider, org_name=org_name, max_links=_MAX_PAGES,
                )

                for target_url in target_urls:
                    try:
                        await page.goto(target_url, wait_until="domcontentloaded", timeout=10000)
                        text = await page.evaluate("() => document.body?.innerText || ''")
                        pages_visited += 1

                        if content_quality_reason(text) is not None:
                            continue

                        page_content = PageContent(
                            url=target_url,
                            text=text,
                            title=await page.title() or "",
                            source_type=SourceType.WEBSITE,
                        )

                        entries = await extract_page_entries(
                            page_content,
                            provider,
                            city,
                            state,
                            store=None,
                            run_id=None,
                            reuse_cached_extractions=False,
                        )
                        if entries:
                            all_entries.extend(entries)
                            logger.info(
                                "Browser research: %d entries from %s",
                                len(entries),
                                target_url,
                            )
                    except Exception:
                        logger.debug("Browser page visit failed: %s", target_url, exc_info=True)
                        continue
            finally:
                await browser.close()

    except Exception:
        logger.warning("Browser research failed for %s", website_url, exc_info=True)

    logger.info(
        "Browser research complete for %s: %d pages visited, %d entries extracted",
        website_url,
        pages_visited,
        len(all_entries),
    )
    return all_entries


async def _select_links_with_llm(
    links: list[dict[str, str]],
    provider: LLMProvider,
    *,
    org_name: str,
    max_links: int,
) -> list[str]:
    """Ask the LLM which links are most likely to contain people, programs, or partners."""
    if not links:
        return []

    # Deduplicate and format links for the LLM
    seen: set[str] = set()
    unique_links: list[dict[str, str]] = []
    for link in links:
        href = link.get("href", "")
        if href and href not in seen:
            seen.add(href)
            unique_links.append(link)

    if not unique_links:
        return []

    link_list = "\n".join(
        f"- {link.get('text', '(no text)')}: {link.get('href', '')}"
        for link in unique_links[:100]  # cap input to avoid token blowup
    )

    messages = [
        Message(
            role="system",
            content=(
                "You select which pages on an organization's website are most likely to "
                "contain information about people (staff, board, leadership), programs, "
                "initiatives, or partner organizations. Return ONLY a JSON array of URLs.\n\n"
                f"Select up to {max_links} URLs. Prioritize pages about people, team, "
                "leadership, board, programs, partners, and organizational structure."
            ),
        ),
        Message(
            role="user",
            content=(
                f"Organization: {org_name or '(unknown)'}\n\n"
                f"Links found on homepage:\n{link_list}"
            ),
        ),
    ]

    try:
        completion: Completion = await provider.complete(messages)
        return _parse_url_list(completion.text, seen)
    except Exception:
        logger.debug("LLM link selection failed", exc_info=True)
        return []


def _parse_url_list(text: str, valid_urls: set[str]) -> list[str]:
    """Parse a JSON array of URLs from LLM response, filtering to known URLs."""
    from atlas_scout.pipeline_support import strip_code_fence

    text = strip_code_fence(text)
    if "</think>" in text:
        text = text.split("</think>")[-1].strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        return []

    if not isinstance(items, list):
        return []

    return [str(url) for url in items if isinstance(url, str) and url in valid_urls]
