"""
Step 1: Query Generation.

Converts location + issue areas into search queries for the autodiscovery
pipeline.
"""

from dataclasses import dataclass

from atlas.pipeline.local_context import LOCAL_CONTEXT
from atlas.taxonomy import ISSUE_SEARCH_TERMS

__all__ = ["SearchQuery", "generate_queries"]


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
    local_context = LOCAL_CONTEXT.get(location, {})
    outlets = local_context.get("outlets", [])

    source_patterns = {
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
    }

    for issue_area_slug in issue_areas:
        if issue_area_slug not in ISSUE_SEARCH_TERMS:
            continue

        keywords_list = ISSUE_SEARCH_TERMS[issue_area_slug]

        for source_category, patterns in source_patterns.items():
            for pattern in patterns:
                expansions = outlets if "{local_outlet}" in pattern and outlets else [None]
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
