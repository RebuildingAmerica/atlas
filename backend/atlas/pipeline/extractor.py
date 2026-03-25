"""
Step 3: Extraction.

Uses Claude API to extract structured entries from web source content.

This is a stub. In production, this would make API calls to Claude with
the extraction prompt described in the system design.
"""

from dataclasses import dataclass

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
    # Stub returns empty list
    # Real implementation would call Claude API
    return []
