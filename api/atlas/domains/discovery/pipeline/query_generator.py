"""API adapter around the shared discovery-engine query generation."""

from atlas_discovery_engine import SearchQuery
from atlas_discovery_engine import generate_queries as _generate_queries

from atlas.domains.discovery.pipeline.local_context import LOCAL_CONTEXT

__all__ = ["SearchQuery", "generate_queries"]


def generate_queries(
    city: str,
    state: str,
    issue_areas: list[str],
) -> list[SearchQuery]:
    """Generate API discovery queries using the shared engine plus Atlas local context."""
    location = f"{city}, {state}"
    local_context = LOCAL_CONTEXT.get(location, {})
    return _generate_queries(
        city,
        state,
        issue_areas,
        local_outlets=list(local_context.get("outlets", [])),
    )
