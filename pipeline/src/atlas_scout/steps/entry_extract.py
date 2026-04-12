"""
Step 3: Entry Extraction.

LLM-based entity extraction from page content using the provider abstraction.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from atlas_shared import ISSUE_AREAS_BY_DOMAIN, PageContent, RawEntry
from atlas_scout.providers.base import LLMProvider, Message

logger = logging.getLogger(__name__)

__all__ = ["extract_entries_stream"]


async def extract_entries_stream(
    pages: AsyncIterator[PageContent],
    provider: LLMProvider,
    city: str,
    state: str,
) -> AsyncIterator[RawEntry]:
    """
    Extract structured entries from page content using an LLM provider.

    Fans out LLM calls bounded by ``provider.max_concurrent``, yielding
    entries as each page is processed.

    Parameters
    ----------
    pages : AsyncIterator[PageContent]
        Async stream of fetched page content.
    provider : LLMProvider
        LLM provider to use for extraction.
    city : str
        Target city (used in extraction prompt).
    state : str
        Target state (used in extraction prompt).

    Yields
    ------
    RawEntry
        Extracted entries with ``source_url`` set to the originating page URL.
    """
    system_prompt = _build_system_prompt(city, state)
    semaphore = asyncio.Semaphore(provider.max_concurrent)

    async def _extract_page(page: PageContent) -> list[RawEntry]:
        if not page.text.strip():
            return []
        async with semaphore:
            messages = [
                Message(
                    role="user",
                    content=(
                        f"Source URL: {page.url}\n"
                        "Extract Atlas entries from the following source text and return JSON only.\n\n"
                        f"{page.text}"
                    ),
                )
            ]
            try:
                completion = await provider.complete(
                    [Message(role="system", content=system_prompt), *messages]
                )
                entries = _parse_extraction_response(completion.text)
                for entry in entries:
                    entry.source_url = page.url
                return entries
            except Exception as exc:
                logger.warning("Extraction failed for %s: %s", page.url, exc)
                return []

    # Collect pages first, then fan out
    page_list: list[PageContent] = [page async for page in pages]

    tasks = [asyncio.create_task(_extract_page(page)) for page in page_list]
    for coro in asyncio.as_completed(tasks):
        entries = await coro
        for entry in entries:
            yield entry


def _build_system_prompt(city: str, state: str) -> str:
    """Build the extraction system prompt with full taxonomy context."""
    taxonomy_lines = [
        f"- {issue.slug}: {issue.name}"
        for issues in ISSUE_AREAS_BY_DOMAIN.values()
        for issue in issues
    ]
    taxonomy_text = "\n".join(taxonomy_lines)
    return (
        "You are extracting structured data from a source document for Atlas.\n\n"
        f"Target location: {city}, {state}\n\n"
        "Issue taxonomy:\n"
        f"{taxonomy_text}\n\n"
        "Return JSON as an array of entries. Each entry must contain: "
        "name, type, description, city, state, geo_specificity, issue_areas, "
        "affiliated_org, website, email, social_media, extraction_context. "
        "Only include people, organizations, initiatives, campaigns, or events "
        "connected to the target location and one or more issue areas."
    )


def _parse_extraction_response(response_text: str) -> list[RawEntry]:
    """Parse LLM JSON output into typed RawEntry objects."""
    try:
        payload = json.loads(_strip_code_fence(response_text))
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse extraction response as JSON: %s", exc)
        return []

    if isinstance(payload, dict):
        payload = payload.get("entries", [])

    if not isinstance(payload, list):
        return []

    entries: list[RawEntry] = []
    for item in payload:
        try:
            entries.append(
                RawEntry(
                    name=item["name"],
                    entry_type=item.get("type") or item.get("entry_type", "organization"),
                    description=item.get("description", ""),
                    city=item.get("city"),
                    state=item.get("state"),
                    geo_specificity=item.get("geo_specificity", "local"),
                    issue_areas=item.get("issue_areas", []),
                    region=item.get("region"),
                    website=item.get("website") or (item.get("contact_surface") or {}).get(
                        "website"
                    ),
                    email=item.get("email") or (item.get("contact_surface") or {}).get("email"),
                    social_media=item.get("social_media")
                    or (item.get("contact_surface") or {}).get("social_media")
                    or {},
                    affiliated_org=item.get("affiliated_org"),
                    extraction_context=item.get("extraction_context", ""),
                )
            )
        except (KeyError, ValueError) as exc:
            logger.debug("Skipping malformed entry item: %s", exc)
            continue

    return entries


def _strip_code_fence(value: str) -> str:
    """Remove optional Markdown code fences around a JSON response."""
    stripped = value.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1]
        stripped = stripped.rsplit("\n```", 1)[0]
    return stripped
