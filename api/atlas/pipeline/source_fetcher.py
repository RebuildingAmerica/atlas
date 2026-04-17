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

import datetime
import logging
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import httpx
import trafilatura

logger = logging.getLogger(__name__)

__all__ = ["FetchedSource", "fetch_sources"]

_MIN_WORD_COUNT = 200
_MAX_SOURCE_AGE_DAYS = 730


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
    queries: Sequence[object],
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
    if not queries:
        return []
    if not _api_key:
        logger.warning("Search API key missing; source fetching skipped")
        return []

    normalized_queries = _normalize_queries(queries)
    search_results = await _search_brave(normalized_queries, _api_key)

    unique_urls: dict[str, dict[str, str | None]] = {}
    for result in search_results:
        url = result.get("url")
        if not url or url in unique_urls:
            continue
        unique_urls[url] = result

    fetched: list[FetchedSource] = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        for url, metadata in unique_urls.items():
            content = await _extract_page_text(client, url)
            if not _should_keep_source(content, metadata.get("age")):
                continue
            fetched.append(
                FetchedSource(
                    url=url,
                    title=metadata.get("title"),
                    publication=metadata.get("publication"),
                    published_date=metadata.get("age"),
                    content=content,
                    source_type=_infer_source_type(url, metadata.get("title")),
                )
            )

    return fetched


def _normalize_queries(queries: Iterable[object]) -> list[str]:
    """Normalize a heterogeneous query list into raw query strings."""
    normalized: list[str] = []
    for query in queries:
        if hasattr(query, "query"):
            normalized.append(str(query.query))
        else:
            normalized.append(str(query))
    return normalized


async def _search_brave(queries: list[str], api_key: str) -> list[dict[str, str | None]]:
    """Execute web searches using Brave Search."""
    headers = {"Accept": "application/json", "X-Subscription-Token": api_key}
    results: list[dict[str, str | None]] = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for query in queries:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": 5},
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
            results.extend(
                {
                    "url": item.get("url"),
                    "title": item.get("title"),
                    "publication": item.get("profile", {}).get("name"),
                    "age": _parse_result_age(item.get("age")),
                }
                for item in payload.get("web", {}).get("results", [])
            )
    return results


async def _extract_page_text(client: httpx.AsyncClient, url: str) -> str:
    """Fetch a page and extract readable text."""
    response = await client.get(url)
    response.raise_for_status()
    extracted = trafilatura.extract(response.text, include_comments=False, include_tables=False)
    return extracted or ""


def _should_keep_source(content: str, published_date: str | None) -> bool:
    """Apply coarse filtering to fetched content."""
    if len(content.split()) < _MIN_WORD_COUNT:
        return False
    if published_date:
        published = date.fromisoformat(published_date)
        if published < datetime.datetime.now(tz=datetime.UTC).date() - timedelta(
            days=_MAX_SOURCE_AGE_DAYS
        ):
            return False
    return True


def _parse_result_age(age_value: str | None) -> str | None:
    """Parse Brave result age values into ISO dates when possible."""
    if not age_value:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", age_value):
        return age_value
    return None


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
