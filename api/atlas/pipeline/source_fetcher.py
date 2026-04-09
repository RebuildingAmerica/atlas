"""
Step 2: Source Fetching.

Executes search queries and fetches web content for extraction.

This is a stub implementation. In production, this would:
- Execute queries via web search API (SerpAPI, Brave, etc.)
- Fetch page content via httpx
- Extract text via trafilatura
- Filter low-value sources
- Rate limiting and error handling
"""

from dataclasses import dataclass

__all__ = ["FetchedSource", "fetch_sources"]


@dataclass
class FetchedSource:
    """A fetched web source ready for extraction."""

    url: str
    """Source URL."""

    title: str | None
    """Page title."""

    publication: str | None
    """Publication name (inferred or stated)."""

    published_date: str | None
    """Publication date (ISO format)."""

    content: str
    """Extracted text content."""

    source_type: str
    """Source type (news_article, op_ed, etc.)."""


async def fetch_sources(
    _queries: list[str],
    _api_key: str | None = None,
) -> list[FetchedSource]:
    """
    Fetch sources for a list of search queries.

    Parameters
    ----------
    _queries : list[str]
        Search query strings.
    _api_key : str | None, optional
        Search API key (e.g., SerpAPI). Default is None.

    Returns
    -------
    list[FetchedSource]
        List of fetched sources.

    Notes
    -----
    This is a stub. In production, this would:
    - Execute each query via web search API
    - Deduplicate URLs across queries
    - Fetch and extract content from each unique URL
    - Filter sources (age, location relevance, content length, paywall status)
    - Handle rate limiting and retries
    """
    # Stub implementation returns empty list
    # Real implementation would call web search API and fetch content
    return []
