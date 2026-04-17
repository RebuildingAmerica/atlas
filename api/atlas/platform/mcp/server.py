"""Atlas MCP server exposing structured retrieval tools."""

from __future__ import annotations

import contextlib
from typing import Any

from mcp import types  # type: ignore[import-not-found]
from mcp.server.fastmcp import Context, FastMCP  # type: ignore[import-not-found]
from mcp.server.fastmcp.tools.base import ToolAnnotations  # type: ignore[import-not-found]
from pydantic import BaseModel, Field

from atlas.domains.catalog.taxonomy import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    get_issue_area_by_slug,
    get_issues_by_domain,
)
from atlas.platform.config import get_settings
from atlas.platform.mcp.data import _STATE_NAMES, AtlasDataService, normalize_place_key

_VALID_STATE_CODES = frozenset(_STATE_NAMES.values())

__all__ = ["build_mcp_server", "main"]

_SERVER_INSTRUCTIONS = """\
Atlas is a curated catalog of civic organizations, programs, and resources across \
the United States, organized by place and issue area.

KEY CONCEPTS:
- An "entity" is an organization, program, initiative, or resource (not a person).
- A "source" is a piece of evidence (article, report, website) that backs an entity.
- "Issue areas" are specific civic topics (e.g., housing_affordability, union_organizing). \
There are 51 issue areas grouped into 11 domains (e.g., Economic Security, Health and \
Social Connection). Use resolve_issue_areas() to find valid slugs from natural language.
- "Coverage" measures how many entities Atlas has for a given place + issue area combination. \
Gaps are issue areas with zero or very few entities.

PLACE FORMATS:
- Tool arguments accept "City, ST" strings (e.g., "Kansas City, MO") or two-letter state \
codes (e.g., "TX"). You can also pass {"city": "Kansas City", "state": "MO"}.
- State resource URIs use the two-letter code: atlas://states/MO
- City resource URIs use lowercase-dash format: atlas://cities/kansas-city-mo

TOOL SELECTION:
- To find entities: search_entities (flexible filters) or get_place_entities (place-first).
- To understand a place: get_place_profile (demographics), get_place_coverage (what Atlas \
covers and where gaps are), get_place_issue_signals (which issues are most represented).
- To go deep: get_entity (full detail), get_entity_sources (provenance), \
get_related_entities (connections via shared place, issues, or sources).
- To explore issues: resolve_issue_areas (natural language to slugs), then filter searches.
- To flag problems: flag_entity or flag_source (prompts user for reason).

PAGINATION:
Search results include a "next_cursor" field. Pass it back as "cursor" to get the next page.

LIMITATIONS:
Atlas is a curated catalog, not a live database. Coverage varies by geography and issue area. \
Some places have detailed profiles; others do not. Source freshness varies.\
"""


async def _log(ctx: Context, message: str) -> None:
    """Log to the MCP client, silently skipping when no session is active."""
    with contextlib.suppress(ValueError):
        await ctx.info(message)


class SearchEntitiesRequest(BaseModel):
    """Structured input for Atlas entity search."""

    place: str | dict[str, str] | None = None
    issue_areas: list[str] | None = None
    text: str | None = None
    entity_types: list[str] | None = None
    source_types: list[str] | None = None
    limit: int = Field(default=20, ge=1)
    cursor: str | None = None


class GetPlaceEntitiesRequest(BaseModel):
    """Structured input for place-scoped Atlas entity search."""

    place: str | dict[str, str]
    issue_areas: list[str] | None = None
    text: str | None = None
    entity_types: list[str] | None = None
    source_types: list[str] | None = None
    limit: int = Field(default=20, ge=1)
    cursor: str | None = None


class SearchSourcesRequest(BaseModel):
    """Structured input for Atlas source search."""

    place: str | dict[str, str] | None = None
    issue_areas: list[str] | None = None
    text: str | None = None
    source_types: list[str] | None = None
    limit: int = Field(default=20, ge=1)
    cursor: str | None = None


def build_mcp_server(  # noqa: PLR0915
    database_url: str | None = None,
    streamable_http_path: str = "/mcp",
) -> FastMCP:
    """Build the Atlas MCP server."""
    settings = get_settings()
    service = AtlasDataService(database_url or settings.database_url)
    mcp = FastMCP(
        "Atlas",
        instructions=_SERVER_INSTRUCTIONS,
        json_response=True,
        streamable_http_path=streamable_http_path,
    )

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Search entities",
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
    )
    async def search_entities(request: SearchEntitiesRequest, ctx: Context) -> dict[str, Any]:
        """Search the Atlas entity catalog by place, issue area, or text. Returns paginated results with cursor support."""
        await _log(
            ctx,
            f"Searching entities: place={request.place}, issues={request.issue_areas}, text={request.text}",
        )
        result = await service.search_entities(**request.model_dump())
        await _log(ctx, f"Found {len(result.get('items', []))} entities")
        return result

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get place entities",
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
    )
    async def get_place_entities(request: GetPlaceEntitiesRequest, ctx: Context) -> dict[str, Any]:
        """Get Atlas entities scoped to a specific place. A convenience wrapper around search_entities with place as the primary filter."""
        await _log(ctx, f"Fetching entities for place={request.place}")
        result = await service.get_place_entities(**request.model_dump())
        await _log(ctx, f"Found {len(result.get('items', []))} entities")
        return result

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get entity",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def get_entity(entity_id: str, ctx: Context) -> dict[str, Any]:
        """Get a single Atlas entity by ID, including its issue areas, sources, and flag status."""
        await _log(ctx, f"Fetching entity {entity_id}")
        return await service.get_entity(entity_id)

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get entity sources",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def get_entity_sources(entity_id: str, ctx: Context) -> dict[str, Any]:
        """Get the sources backing one Atlas entity. Each source includes its URL, type, publication date, and extraction context."""
        await _log(ctx, f"Fetching sources for entity {entity_id}")
        return await service.get_entity_sources(entity_id)

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Search sources",
        annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
    )
    async def search_sources(request: SearchSourcesRequest, ctx: Context) -> dict[str, Any]:
        """Search Atlas sources by place, issue area, or text. Sources are the evidence backing catalog entities."""
        await _log(ctx, f"Searching sources: place={request.place}, text={request.text}")
        result = await service.search_sources(**request.model_dump())
        await _log(ctx, f"Found {len(result.get('items', []))} sources")
        return result

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Resolve issue areas",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def resolve_issue_areas(text: str, ctx: Context, limit: int = 10) -> dict[str, Any]:
        """Map natural language to Atlas issue area slugs. Use this to discover valid issue_areas values before filtering searches."""
        await _log(ctx, f"Resolving issue areas from: {text!r}")
        result = await service.resolve_issue_areas(text, limit=limit)
        await _log(ctx, f"Resolved {len(result.get('matches', []))} issue areas")
        return result

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get place issue signals",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def get_place_issue_signals(
        place: str | dict[str, str],
        ctx: Context,
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Summarize which issue areas Atlas represents for a place, with entity counts and top entities per issue."""
        await _log(ctx, f"Fetching issue signals for place={place}")
        return await service.get_place_issue_signals(place, issue_areas=issue_areas)

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get place profile",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def get_place_profile(place: str | dict[str, str], ctx: Context) -> dict[str, Any]:
        """Get demographic and socioeconomic context for a place, including population, income, and key indicators."""
        await _log(ctx, f"Fetching place profile for {place}")
        return await service.get_place_profile(place)

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get place coverage",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def get_place_coverage(
        place: str | dict[str, str],
        ctx: Context,
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Get Atlas coverage for a place — entity counts per issue area, covered/missing/thin issue areas, and uncovered domains."""
        await _log(ctx, f"Fetching coverage for place={place}")
        return await service.get_place_coverage(place, issue_areas=issue_areas)

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Get related entities",
        annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    )
    async def get_related_entities(
        entity_id: str,
        ctx: Context,
        relation_types: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get entities related to a given entity through shared places, issue areas, sources, or organizational affiliation."""
        await _log(ctx, f"Fetching related entities for {entity_id}")
        result = await service.get_related_entities(
            entity_id,
            relation_types=relation_types,
            limit=limit,
        )
        await _log(ctx, f"Found {len(result.get('items', []))} related entities")
        return result

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://entities/{entity_id}",
        title="Entity",
        description="A civic organization, program, or resource tracked by Atlas",
        mime_type="application/json",
    )
    async def entity_resource(entity_id: str) -> dict[str, Any]:
        """Read an Atlas entity resource."""
        return await service.get_entity(entity_id)

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://sources/{source_id}",
        title="Source",
        description="An evidence source backing an Atlas entity — includes URL, type, and publication date",
        mime_type="application/json",
    )
    async def source_resource(source_id: str) -> dict[str, Any]:
        """Read a source resource."""
        source = await service.search_sources(limit=500)
        for item in source["items"]:
            if item["id"] == source_id:
                return dict(item)
        raise _source_not_found(source_id)

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://issues/{issue_key}",
        title="Issue area",
        description="An Atlas issue area by slug (e.g., housing_affordability) or a domain by slug (e.g., economic-security) with its child issue areas",
        mime_type="application/json",
    )
    async def issue_resource(issue_key: str) -> dict[str, Any]:
        """Read an issue area or domain by slug."""
        issue = get_issue_area_by_slug(issue_key)
        if issue is not None:
            return {
                "id": issue.slug,
                "slug": issue.slug,
                "name": issue.name,
                "domain": issue.domain,
                "description": issue.description,
            }

        matched_domain = next(
            (domain for domain in DOMAINS if domain.lower().replace(" ", "-") == issue_key.lower()),
            None,
        )
        if matched_domain is not None:
            return {
                "domain": matched_domain,
                "issues": [
                    {
                        "id": issue.slug,
                        "slug": issue.slug,
                        "name": issue.name,
                        "description": issue.description,
                    }
                    for issue in get_issues_by_domain(matched_domain)
                ],
            }
        raise _issue_resource_not_found(issue_key)

    # --- State resources ---

    def _validate_state_code(code: str) -> str:
        upper = code.upper()
        if upper not in _VALID_STATE_CODES:
            raise ValueError(f"Unknown state code: {code}")  # noqa: TRY003
        return upper

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://states/{state_code}/profile",
        title="State profile",
        description="Demographic and socioeconomic context for a US state",
        mime_type="application/json",
    )
    async def state_profile_resource(state_code: str) -> dict[str, Any]:
        """Read a state profile."""
        return await service.get_place_profile(_validate_state_code(state_code))

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://states/{state_code}/issue-signals",
        title="State issue signals",
        description="Which issue areas Atlas represents for a US state, with entity counts and top entities per issue",
        mime_type="application/json",
    )
    async def state_issue_signals_resource(state_code: str) -> dict[str, Any]:
        """Read issue signals for a state."""
        return await service.get_place_issue_signals(_validate_state_code(state_code))

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://states/{state_code}/coverage",
        title="State coverage",
        description="Atlas coverage analysis for a US state — entity counts per issue area, gaps, and uncovered domains",
        mime_type="application/json",
    )
    async def state_coverage_resource(state_code: str) -> dict[str, Any]:
        """Read state coverage data."""
        return await service.get_place_coverage(_validate_state_code(state_code))

    # --- City resources ---

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://cities/{city_key}/profile",
        title="City profile",
        description="Demographic and socioeconomic context for a US city (city_key format: kansas-city-mo)",
        mime_type="application/json",
    )
    async def city_profile_resource(city_key: str) -> dict[str, Any]:
        """Read a city profile."""
        return await service.get_place_profile(normalize_place_key(city_key))

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://cities/{city_key}/issue-signals",
        title="City issue signals",
        description="Which issue areas Atlas represents for a US city, with entity counts and top entities per issue",
        mime_type="application/json",
    )
    async def city_issue_signals_resource(city_key: str) -> dict[str, Any]:
        """Read issue signals for a city."""
        return await service.get_place_issue_signals(normalize_place_key(city_key))

    @mcp.resource(  # type: ignore[untyped-decorator]
        "atlas://cities/{city_key}/coverage",
        title="City coverage",
        description="Atlas coverage analysis for a US city — entity counts per issue area, gaps, and uncovered domains",
        mime_type="application/json",
    )
    async def city_coverage_resource(city_key: str) -> dict[str, Any]:
        """Read city coverage data."""
        return await service.get_place_coverage(normalize_place_key(city_key))

    # --- Prompts ---

    @mcp.prompt(  # type: ignore[untyped-decorator]
        title="Investigate a place",
        description="Investigate what Atlas knows about a place, optionally focused on an issue area",
    )
    async def investigate_place(place: str, issue_area: str | None = None) -> str:
        """Guide an agent through a structured Atlas investigation of a place."""
        focus = f", focusing on {issue_area}" if issue_area else ""
        return (
            f"Investigate {place}{focus} using the Atlas catalog.\n\n"
            f"1. Start with get_place_profile('{place}') for demographic context.\n"
            f"2. Use get_place_coverage('{place}'"
            + (f", issue_areas=['{issue_area}']" if issue_area else "")
            + ") to see what Atlas covers and where gaps exist.\n"
            f"3. Use get_place_issue_signals('{place}') to see which issues are most represented.\n"
            f"4. Search for specific entities with search_entities(place='{place}'"
            + (f", issue_areas=['{issue_area}']" if issue_area else "")
            + ").\n"
            f"5. For interesting entities, use get_entity() and get_entity_sources() for details.\n\n"
            f"Synthesize your findings into a clear summary of what Atlas reveals about {place}."
        )

    @mcp.prompt(  # type: ignore[untyped-decorator]
        title="Assess coverage gaps",
        description="Assess where Atlas has coverage gaps for a place and what's missing",
    )
    async def assess_coverage_gaps(place: str) -> str:
        """Guide an agent through a coverage gap assessment."""
        return (
            f"Assess Atlas coverage gaps for {place}.\n\n"
            f"1. Use resolve_issue_areas() with a broad query to discover the issue areas Atlas tracks.\n"
            f"2. Use get_place_coverage('{place}') to see entity counts per issue area.\n"
            f"3. Use get_place_issue_signals('{place}') to see which issues have the most signal.\n"
            f"4. Identify domains with zero or very few entities — these are gaps.\n"
            f"5. For domains with coverage, check source freshness via get_entity_sources().\n\n"
            f"Report: which issue areas are well-covered, which have gaps, and which have stale data."
        )

    @mcp.prompt(  # type: ignore[untyped-decorator]
        title="Compare two places",
        description="Compare Atlas coverage between two places",
    )
    async def compare_places(place_a: str, place_b: str, issue_area: str | None = None) -> str:
        """Guide an agent through a comparative analysis of two places."""
        focus = f" for {issue_area}" if issue_area else ""
        return (
            f"Compare Atlas coverage{focus} between {place_a} and {place_b}.\n\n"
            f"1. Get profiles for both: get_place_profile('{place_a}') and get_place_profile('{place_b}').\n"
            f"2. Get coverage for both: get_place_coverage() for each place"
            + (f" with issue_areas=['{issue_area}']" if issue_area else "")
            + ".\n"
            "3. Get issue signals for both places.\n"
            "4. Compare entity counts, issue distribution, and source freshness.\n\n"
            "Highlight where one place has stronger coverage and where the other leads."
        )

    @mcp.prompt(  # type: ignore[untyped-decorator]
        title="Explore an issue area",
        description="Explore an Atlas issue area — what it covers, related entities, and geographic spread",
    )
    async def explore_issue_area(issue_area: str) -> str:
        """Guide an agent through exploring a specific issue area across Atlas."""
        return (
            f"Explore the '{issue_area}' issue area across the Atlas catalog.\n\n"
            f"1. Read atlas://issues/{issue_area} to understand what this issue area covers.\n"
            f"2. Use search_entities(issue_areas=['{issue_area}']) to find entities tagged with this issue.\n"
            f"3. Pick a few entities and use get_entity() + get_entity_sources() for depth.\n"
            f"4. Use get_related_entities() to see how entities in this area connect.\n"
            f"5. Try a few different places with get_place_issue_signals() to see geographic spread.\n\n"
            f"Summarize: what kinds of organizations work on {issue_area}, where are they concentrated, "
            f"and what sources does Atlas have for them."
        )

    # --- Completions ---

    @mcp.completion()  # type: ignore[untyped-decorator]
    async def handle_completion(
        _ref: types.PromptReference | types.ResourceTemplateReference,
        argument: types.CompletionArgument,
        _context: types.CompletionContext | None,
    ) -> types.Completion | None:
        """Autocomplete issue area slugs and suggest place key formats."""
        if argument.name in ("issue_key", "issue_area"):
            partial = argument.value.lower()
            matches = sorted(s for s in ALL_ISSUE_SLUGS if s.startswith(partial))
            return types.Completion(values=matches[:20])

        if argument.name == "state_code":
            partial = argument.value.upper()
            matches = sorted(s for s in _VALID_STATE_CODES if s.startswith(partial))
            return types.Completion(values=matches[:20])

        if argument.name == "city_key" and not argument.value:
            return types.Completion(
                values=["kansas-city-mo", "denver-co", "detroit-mi", "gary-in", "new-york-ny"],
            )

        return None

    # --- Elicitation-based flagging ---

    class EntityFlagInput(BaseModel):
        """Structured input for flagging an Atlas entity."""

        reason: str = Field(
            description="Why this entity should be flagged (e.g., stale, incorrect, duplicate)"
        )
        note: str | None = Field(default=None, description="Additional context about the flag")

    class SourceFlagInput(BaseModel):
        """Structured input for flagging an Atlas source."""

        reason: str = Field(
            description="Why this source should be flagged (e.g., broken link, outdated, irrelevant)"
        )
        note: str | None = Field(default=None, description="Additional context about the flag")

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Flag entity",
        annotations=ToolAnnotations(
            readOnlyHint=False, destructiveHint=False, idempotentHint=False
        ),
    )
    async def flag_entity(entity_id: str, ctx: Context) -> dict[str, Any]:
        """Flag an Atlas entity for operator review. Prompts the user for a reason and optional note before submitting."""
        entity = await service.get_entity(entity_id)
        entity_name = entity.get("name", entity_id)
        await _log(ctx, f"Requesting flag input for entity '{entity_name}'")
        result = await ctx.elicit(
            f"Flag entity '{entity_name}'? Please provide a reason.",
            EntityFlagInput,
        )
        if result.action == "accept" and result.data:
            flag = await service.create_entity_flag(
                entity_id=entity_id,
                reason=result.data.reason,
                note=result.data.note,
            )
            await _log(ctx, f"Entity '{entity_name}' flagged: {result.data.reason}")
            return {"flagged": True, "flag_id": flag["id"], "entity_id": entity_id}
        return {"flagged": False, "reason": "User declined"}

    @mcp.tool(  # type: ignore[untyped-decorator]
        title="Flag source",
        annotations=ToolAnnotations(
            readOnlyHint=False, destructiveHint=False, idempotentHint=False
        ),
    )
    async def flag_source(source_id: str, ctx: Context) -> dict[str, Any]:
        """Flag an Atlas source for operator review. Prompts the user for a reason and optional note before submitting."""
        await _log(ctx, f"Requesting flag input for source {source_id}")
        result = await ctx.elicit(
            f"Flag source '{source_id}'? Please provide a reason.",
            SourceFlagInput,
        )
        if result.action == "accept" and result.data:
            flag = await service.create_source_flag(
                source_id=source_id,
                reason=result.data.reason,
                note=result.data.note,
            )
            await _log(ctx, f"Source {source_id} flagged: {result.data.reason}")
            return {"flagged": True, "flag_id": flag["id"], "source_id": source_id}
        return {"flagged": False, "reason": "User declined"}

    return mcp


def main() -> None:
    """Run the Atlas MCP server over stdio."""
    build_mcp_server().run(transport="stdio")


def _source_not_found(source_id: str) -> ValueError:
    return ValueError(f"Source not found: {source_id}")


def _issue_resource_not_found(issue_key: str) -> ValueError:
    return ValueError(f"Issue resource not found: {issue_key}")


if __name__ == "__main__":
    main()
