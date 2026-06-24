"""
Step 2: Source Fetching.

Executes search queries through a pluggable :class:`SearchProvider` and fetches
web content for extraction. Routing search through the provider abstraction
means a rate limit or vendor outage degrades to fewer sources instead of
zeroing out a city, and the vendor stays swappable without touching pipeline
code.
"""

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import httpx
import trafilatura
from atlas_discovery_engine import BraveSearchProvider, SearchProvider, SearchResult

logger = logging.getLogger(__name__)

__all__ = ["FetchedSource", "build_search_provider", "fetch_sources"]

MAX_SOURCE_AGE_DAYS = 730
MIN_SOURCE_WORDS = 200


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


def build_search_provider(search_api_key: str | None) -> SearchProvider | None:
    """Build the search provider for a discovery run.

    Parameters
    ----------
    search_api_key : str | None
        The Brave search subscription token, when configured.

    Returns
    -------
    SearchProvider | None
        A Brave-backed provider when a key is present, else None to signal that
        search must be skipped rather than guessed at.
    """
    if not search_api_key:
        return None
    return BraveSearchProvider(api_key=search_api_key)


async def fetch_sources(
    queries: Sequence[object],
    provider: SearchProvider | None = None,
) -> list[FetchedSource]:
    """
    Fetch sources for a list of search queries.

    Parameters
    ----------
    queries : Sequence[object]
        Search query strings or query objects exposing a ``query`` attribute.
    provider : SearchProvider | None, optional
        The search provider to execute the queries. When None, source fetching
        is skipped. Default is None.

    Returns
    -------
    list[FetchedSource]
        List of fetched sources. A provider that returns no results (for
        example during a vendor outage) yields an empty list rather than
        failing the run.
    """
    if not queries:
        return []
    if provider is None:
        logger.warning("Search provider missing; source fetching skipped")
        return []

    normalized_queries = _normalize_queries(queries)
    search_results = await provider.search(normalized_queries)

    unique: dict[str, SearchResult] = {}
    for result in search_results:
        if result.url in unique:
            continue
        unique[result.url] = result

    fetched: list[FetchedSource] = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        for url, result in unique.items():
            content = await _extract_page_text(client, url)
            if not _should_keep_source(content, result.published):
                continue
            fetched.append(
                FetchedSource(
                    url=url,
                    title=result.title,
                    publication=result.publication,
                    published_date=result.published,
                    content=content,
                    source_type=_infer_source_type(url, result.title),
                )
            )

    return fetched


def _normalize_queries(queries: Iterable[object]) -> list[str]:
    """Normalize a heterogeneous query list into raw query strings."""
    return [str(query.query) if hasattr(query, "query") else str(query) for query in queries]


async def _extract_page_text(client: httpx.AsyncClient, url: str) -> str:
    """Fetch a page and extract readable text."""
    response = await client.get(url)
    response.raise_for_status()
    extracted = trafilatura.extract(response.text, include_comments=False, include_tables=False)
    return extracted or ""


def _should_keep_source(content: str, published_date: str | None) -> bool:
    """Apply coarse filtering to fetched content."""
    if len(content.split()) < MIN_SOURCE_WORDS:
        return False
    if published_date:
        published = date.fromisoformat(published_date)
        if published < _today_date() - timedelta(days=MAX_SOURCE_AGE_DAYS):
            return False
    return True


def _today_date() -> date:
    """Return the current UTC calendar date for source freshness checks."""
    return datetime.now(UTC).date()


def _infer_source_type(url: str, title: str | None) -> str:
    """Infer Atlas source type from the URL/title."""
    lowered = f"{url} {title or ''}".lower()
    if "podcast" in lowered:
        return "podcast"
    if "report" in lowered or "pdf" in lowered:
        return "report"
    if "gov" in lowered:
        return "government_record"
    if "youtube" in lowered or "video" in lowered:
        return "video"
    if "twitter.com" in lowered or "x.com" in lowered or "instagram.com" in lowered:
        return "social_media"
    return "news_article"
