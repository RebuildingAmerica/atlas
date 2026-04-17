"""
Step 3: Extraction.

Uses Claude API to extract structured entries from web source content.

This is a stub. In production, this would make API calls to Claude with
the extraction prompt described in the system design.
"""

import json
import logging
from dataclasses import dataclass

from anthropic import AsyncAnthropic

from atlas.domains.catalog.taxonomy import ISSUE_AREAS_BY_DOMAIN

logger = logging.getLogger(__name__)

__all__ = ["ExtractedEntry", "extract_entries"]


@dataclass
class ExtractedEntry:
    """A structured entry extracted from a source."""

    name: str
    """Entry name."""

    entry_type: str
    """Type (person, organization, initiative, campaign, event)."""

    description: str
    """1-3 sentence description."""

    city: str | None
    """City."""

    state: str | None
    """2-letter state code."""

    geo_specificity: str
    """Geographic scope (local, regional, statewide, national)."""

    issue_areas: list[str]
    """List of issue area slugs."""

    region: str | None = None
    """Regional name (e.g., 'Kansas City metro')."""

    website: str | None = None
    """Website URL."""

    email: str | None = None
    """Email address."""

    social_media: dict[str, str] | None = None
    """Social media handles."""

    affiliated_org: str | None = None
    """Name of affiliated organization (if a person)."""

    extraction_context: str | None = None
    """The passage(s) supporting this extraction."""


async def extract_entries(
    _url: str,
    _content: str,
    _city: str,
    _state: str,
    _api_key: str | None = None,
) -> list[ExtractedEntry]:
    """
    Extract structured entries from source content using Claude.

    Parameters
    ----------
    _url : str
        Source URL.
    _content : str
        Extracted text content from the source.
    _city : str
        Target city.
    _state : str
        Target state (2-letter code).
    _api_key : str | None, optional
        Anthropic API key. Default is None.

    Returns
    -------
    list[ExtractedEntry]
        Extracted entries.

    Notes
    -----
    This is a stub. In production, this would:
    - Call Claude API with extraction system prompt
    - Include full issue taxonomy
    - Return structured JSON with extracted entries
    - Handle parsing and validation
    - Implement retries and error handling
    """
    if not _api_key or not _content.strip():
        logger.warning("Anthropic API key missing or content empty; extraction skipped")
        return []

    client = AsyncAnthropic(api_key=_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        system=_build_system_prompt(_city, _state),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Source URL: {_url}\n"
                    "Extract Atlas entries from the following source text and return JSON only.\n\n"
                    f"{_content}"
                ),
            }
        ],
    )
    text_blocks = [
        block.text  # type: ignore[union-attr]
        for block in response.content
        if getattr(block, "type", None) == "text"
    ]
    return _parse_extraction_response("\n".join(text_blocks))


def _build_system_prompt(city: str, state: str) -> str:
    """Build the extraction prompt with taxonomy context."""
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


def _parse_extraction_response(response_text: str) -> list[ExtractedEntry]:
    """Parse Claude JSON output into typed entries."""
    payload = json.loads(_strip_code_fence(response_text))
    if isinstance(payload, dict):
        payload = payload.get("entries", [])
    return [
        ExtractedEntry(
            name=item["name"],
            entry_type=item["type"],
            description=item["description"],
            city=item.get("city"),
            state=item.get("state"),
            geo_specificity=item["geo_specificity"],
            issue_areas=item.get("issue_areas", []),
            region=item.get("region"),
            website=item.get("website") or item.get("contact_surface", {}).get("website"),
            email=item.get("email") or item.get("contact_surface", {}).get("email"),
            social_media=item.get("social_media")
            or item.get("contact_surface", {}).get("social_media"),
            affiliated_org=item.get("affiliated_org"),
            extraction_context=item.get("extraction_context"),
        )
        for item in payload
    ]


def _strip_code_fence(value: str) -> str:
    """Remove optional Markdown fences around a JSON response."""
    stripped = value.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1]
        stripped = stripped.rsplit("\n```", 1)[0]
    return stripped
