"""
Step 3: Extraction.

Uses Claude API to extract structured entries from web source content.

Delegates prompt building, response parsing, normalization, and validation
to the shared atlas_discovery_engine extraction primitives.
"""

import logging

from anthropic import AsyncAnthropic
from atlas_discovery_engine import (
    build_extraction_system_prompt,
    build_identify_system_prompt,
    parse_extraction_response,
    parse_identify_response,
    validate_entries,
)
from atlas_shared import PageContent, RawEntry

logger = logging.getLogger(__name__)

__all__ = ["extract_entries"]

_MAX_ATTEMPTS = 3
_EXTRACTION_MODEL = "claude-sonnet-4-20250514"


async def extract_entries(
    url: str,
    content: str,
    city: str,
    state: str,
    api_key: str | None = None,
) -> list[RawEntry]:
    """
    Extract structured entries from source content using a two-pass strategy.

    Pass 1 identifies named entities in the text.
    Pass 2 extracts full structured details for each identified entity.
    Results are validated against the source text to drop hallucinations.

    Parameters
    ----------
    url : str
        Source URL.
    content : str
        Extracted text content from the source.
    city : str
        Target city.
    state : str
        Target state (2-letter code).
    api_key : str | None, optional
        Anthropic API key.

    Returns
    -------
    list[RawEntry]
        Validated extracted entries.
    """
    if not api_key or not content.strip():
        logger.warning("Anthropic API key missing or content empty; extraction skipped")
        return []

    client = AsyncAnthropic(api_key=api_key)
    page = PageContent(url=url, text=content)

    # --- Pass 1: Identify named entities ---
    identified = await _pass_identify(client, page)
    if not identified:
        return []

    # --- Pass 2: Enrich with structured details ---
    system_prompt = build_extraction_system_prompt(city, state)
    entries = await _pass_enrich(client, identified, page, system_prompt)

    # --- Validate against source text ---
    entries = validate_entries(entries, page)

    for entry in entries:
        entry.source_url = url

    return entries


async def _pass_identify(
    client: AsyncAnthropic,
    page: PageContent,
) -> list[dict[str, str]]:
    """Pass 1: Identify all named civic entities in the text."""
    system_prompt = build_identify_system_prompt()

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await client.messages.create(
                model=_EXTRACTION_MODEL,
                max_tokens=4000,
                system=system_prompt,
                messages=[{"role": "user", "content": page.text}],
            )
            text = _extract_text(response)
            return parse_identify_response(text)
        except Exception:
            if attempt >= _MAX_ATTEMPTS:
                logger.warning(
                    "Pass 1 (identify) failed for %s after %d attempts",
                    page.url,
                    _MAX_ATTEMPTS,
                )
                return []

    return []


async def _pass_enrich(
    client: AsyncAnthropic,
    identified: list[dict[str, str]],
    page: PageContent,
    system_prompt: str,
) -> list[RawEntry]:
    """Pass 2: Enrich identified entities with structured details."""
    entity_summary = "\n".join(
        f'- {e["name"]} ({e.get("type", "unknown")}): "{e.get("quote", "")}"' for e in identified
    )

    user_content = (
        f"Source URL: {page.url}\n\n"
        "These entities were identified in the text below. "
        "For each one, extract the full structured entry.\n\n"
        f"IDENTIFIED ENTITIES:\n{entity_summary}\n\n"
        f"SOURCE TEXT:\n{page.text}"
    )

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await client.messages.create(
                model=_EXTRACTION_MODEL,
                max_tokens=8000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
            )
            text = _extract_text(response)
            return parse_extraction_response(text=text)
        except Exception:
            if attempt >= _MAX_ATTEMPTS:
                logger.warning(
                    "Pass 2 (enrich) failed for %s after %d attempts",
                    page.url,
                    _MAX_ATTEMPTS,
                )
                return []

    return []


def _extract_text(response: object) -> str:
    """Pull text blocks from an Anthropic Messages response."""
    blocks = getattr(response, "content", [])
    return "\n".join(
        getattr(block, "text", "") for block in blocks if getattr(block, "type", None) == "text"
    )
