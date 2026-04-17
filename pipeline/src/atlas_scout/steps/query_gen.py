"""
Step 1: Query Generation.

Converts location + issue areas into search queries for the autodiscovery
pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas_shared import ISSUE_SEARCH_TERMS

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

__all__ = ["SearchQuery", "generate_queries", "generate_queries_stream"]

_SOURCE_PATTERNS: dict[str, list[str]] = {
    "local_journalism": ["{location} {keywords}"],
    "nonprofits": [
        "{location} {keywords} nonprofit",
        "{location} {keywords} organization",
    ],
    "individuals": [
        "{location} {keywords} organizer",
        "{location} {keywords} advocate",
        "{location} {keywords} leader",
    ],
    "campaigns": [
        "{location} {keywords} campaign",
        "{location} {keywords} initiative",
    ],
    "academic_policy": [
        "{location} {keywords} study",
        "{location} {keywords} university research",
    ],
    "government": [
        "{location} {keywords} city council",
        "{location} {keywords} government program",
        "{location} {keywords} public hearing",
    ],
    "coalitions": [
        "{location} {keywords} coalition",
        "{location} {keywords} alliance",
        "{location} {keywords} network",
    ],
    "events": [
        "{location} {keywords} rally",
        "{location} {keywords} town hall",
        "{location} {keywords} community meeting",
    ],
    "directories": [
        'site:guidestar.org "{keywords}" {location}',
        'site:greatnonprofits.org "{keywords}" {location}',
    ],
    "social_media": [
        'site:linkedin.com "{keywords}" {location}',
    ],
}


@dataclass
class SearchQuery:
    """A search query for the pipeline."""

    query: str
    """The search string."""

    source_category: str
    """Source category (e.g., 'local_journalism', 'nonprofits')."""

    issue_area: str
    """Issue area slug this query targets."""


def generate_queries(
    city: str,
    state: str,
    issue_areas: list[str],
) -> list[SearchQuery]:
    """
    Generate search queries for a location and set of issue areas.

    Parameters
    ----------
    city : str
        City name (e.g., "Kansas City").
    state : str
        2-letter state code (e.g., "MO").
    issue_areas : list[str]
        List of issue area slugs to query.

    Returns
    -------
    list[SearchQuery]
        Generated search queries.
    """
    queries: list[SearchQuery] = []
    location = f"{city}, {state}"

    for issue_area_slug in issue_areas:
        if issue_area_slug not in ISSUE_SEARCH_TERMS:
            continue

        keywords_list = ISSUE_SEARCH_TERMS[issue_area_slug]

        for source_category, patterns in _SOURCE_PATTERNS.items():
            for pattern in patterns:
                for keywords in keywords_list:
                    query_text = pattern.format(
                        location=location,
                        keywords=keywords,
                    ).strip()
                    queries.append(
                        SearchQuery(
                            query=" ".join(query_text.split()),
                            source_category=source_category,
                            issue_area=issue_area_slug,
                        )
                    )

    return queries


async def generate_queries_stream(
    city: str,
    state: str,
    issue_areas: list[str],
) -> AsyncIterator[SearchQuery]:
    """
    Async generator variant of generate_queries.

    Yields queries one at a time, allowing downstream consumers to start
    processing before all queries are generated.

    Parameters
    ----------
    city : str
        City name (e.g., "Kansas City").
    state : str
        2-letter state code (e.g., "MO").
    issue_areas : list[str]
        List of issue area slugs to query.

    Yields
    ------
    SearchQuery
        Generated search queries.
    """
    for query in generate_queries(city, state, issue_areas):
        yield query
