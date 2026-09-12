"""Shared query-generation primitives."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import AsyncIterator
from dataclasses import dataclass
from itertools import chain, islice, zip_longest

from atlas_shared import ISSUE_SEARCH_TERMS

__all__ = [
    "SearchQuery",
    "generate_queries",
    "generate_queries_stream",
    "sample_queries_across_categories",
]

_DEFAULT_SOURCE_PATTERNS: dict[str, list[str]] = {
    "local_journalism": [
        "{location} {keywords}",
        "{location} {keywords} {local_outlet}",
    ],
    "nonprofits": [
        "{location} {keywords} nonprofit",
        "{location} {keywords} organization",
    ],
    "individuals": [
        "{location} {keywords} organizer",
        "{location} {keywords} advocate",
        "{location} {keywords} leader",
        "{location} {keywords} director",
    ],
    "campaigns": [
        "{location} {keywords} campaign",
        "{location} {keywords} initiative",
        "{location} {keywords} ballot measure",
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


@dataclass(frozen=True)
class SearchQuery:
    """A single search query emitted by the discovery engine."""

    query: str
    source_category: str
    issue_area: str


def generate_queries(
    city: str,
    state: str,
    issue_areas: list[str],
    *,
    local_outlets: list[str] | None = None,
    source_patterns: dict[str, list[str]] | None = None,
) -> list[SearchQuery]:
    """Generate normalized search queries for the given location and issue slugs."""
    queries: list[SearchQuery] = []
    location = f"{city}, {state}"
    patterns_by_source = source_patterns or _DEFAULT_SOURCE_PATTERNS

    for issue_area_slug in issue_areas:
        keywords_list = ISSUE_SEARCH_TERMS.get(issue_area_slug)
        if not keywords_list:
            continue

        for source_category, patterns in patterns_by_source.items():
            for pattern in patterns:
                expansions = (
                    local_outlets if "{local_outlet}" in pattern and local_outlets else [None]
                )
                for keywords in keywords_list:
                    for local_outlet in expansions:
                        query_text = pattern.format(
                            location=location,
                            keywords=keywords,
                            local_outlet=local_outlet or "",
                        ).strip()
                        queries.append(
                            SearchQuery(
                                query=" ".join(query_text.split()),
                                source_category=source_category,
                                issue_area=issue_area_slug,
                            )
                        )

    return queries


def sample_queries_across_categories(queries: list[SearchQuery], limit: int) -> list[SearchQuery]:
    """Take up to ``limit`` queries, spread evenly over source categories.

    :func:`generate_queries` emits every query for one category before moving
    to the next, so truncating the list head-first would search local
    journalism and nothing else. This deals one query from each category in
    turn, so a capped run still reaches nonprofits, government, coalitions and
    the rest.

    Parameters
    ----------
    queries : list[SearchQuery]
        The full generated query list, grouped by source category.
    limit : int
        Maximum number of queries to keep. A non-positive limit keeps none.

    Returns
    -------
    list[SearchQuery]
        At most ``limit`` queries, ordered by round-robin over categories.
    """
    if limit <= 0:
        return []
    if len(queries) <= limit:
        return queries

    by_category: defaultdict[str, list[SearchQuery]] = defaultdict(list)
    for query in queries:
        by_category[query.source_category].append(query)

    interleaved = chain.from_iterable(zip_longest(*by_category.values()))
    return list(islice((query for query in interleaved if query is not None), limit))


async def generate_queries_stream(
    city: str,
    state: str,
    issue_areas: list[str],
    *,
    local_outlets: list[str] | None = None,
    source_patterns: dict[str, list[str]] | None = None,
) -> AsyncIterator[SearchQuery]:
    """Async generator variant of :func:`generate_queries`."""
    for query in generate_queries(
        city,
        state,
        issue_areas,
        local_outlets=local_outlets,
        source_patterns=source_patterns,
    ):
        yield query
