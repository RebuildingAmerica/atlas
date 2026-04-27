"""FastMCP server exposing Atlas catalog tools over Streamable HTTP."""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING, Any

from mcp.server.fastmcp import FastMCP

from atlas.platform.config import get_settings

from .data import AtlasDataService

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from starlette.applications import Starlette

__all__ = [
    "build_mcp",
    "get_mcp",
    "get_mcp_asgi_app",
    "mcp_session_lifespan",
]


def build_mcp() -> FastMCP:
    """Construct a FastMCP server with all Atlas read tools registered.

    The server is configured for stateless Streamable HTTP so it can run behind
    a horizontally-scaled load balancer (Cloud Run) without sticky sessions.
    `streamable_http_path="/"` collapses the default `/mcp` suffix so the
    Streamable HTTP root sits directly at whatever mount point the host app
    chooses (Atlas mounts at `/mcp`).
    """
    mcp = FastMCP(
        "Atlas",
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
    )

    @mcp.tool()
    async def search_entities(  # noqa: PLR0913
        place: str | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        entity_types: list[str] | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Search Atlas entities by place, issue area, and free-text query."""
        service = AtlasDataService(get_settings().database_url)
        return await service.search_entities(
            place=place,
            issue_areas=issue_areas,
            text=text,
            entity_types=entity_types,
            source_types=source_types,
            limit=limit,
            cursor=cursor,
        )

    @mcp.tool()
    async def get_entity(entity_id: str) -> dict[str, Any]:
        """Get one Atlas entity with its sources, issue areas, and relationship ids."""
        service = AtlasDataService(get_settings().database_url)
        return await service.get_entity(entity_id)

    @mcp.tool()
    async def get_entity_sources(entity_id: str) -> dict[str, Any]:
        """Return the public sources backing one Atlas entity."""
        service = AtlasDataService(get_settings().database_url)
        return await service.get_entity_sources(entity_id)

    @mcp.tool()
    async def search_sources(  # noqa: PLR0913
        place: str | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Search Atlas sources with optional place, issue, and free-text filters."""
        service = AtlasDataService(get_settings().database_url)
        return await service.search_sources(
            place=place,
            issue_areas=issue_areas,
            text=text,
            source_types=source_types,
            limit=limit,
            cursor=cursor,
        )

    @mcp.tool()
    async def get_place_entities(  # noqa: PLR0913
        place: str,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        entity_types: list[str] | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Get entities Atlas tracks for a specific place."""
        service = AtlasDataService(get_settings().database_url)
        return await service.search_entities(
            place=place,
            issue_areas=issue_areas,
            text=text,
            entity_types=entity_types,
            source_types=source_types,
            limit=limit,
            cursor=cursor,
        )

    @mcp.tool()
    async def get_place_profile(place: str) -> dict[str, Any]:
        """Return demographic and socioeconomic context for a place."""
        service = AtlasDataService(get_settings().database_url)
        return await service.get_place_profile(place)

    @mcp.tool()
    async def get_place_coverage(
        place: str,
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Summarize Atlas coverage gaps and entity counts for a place."""
        service = AtlasDataService(get_settings().database_url)
        return await service.get_place_coverage(place, issue_areas=issue_areas)

    @mcp.tool()
    async def get_place_issue_signals(
        place: str,
        issue_areas: list[str] | None = None,
        top_entities_per_issue: int = 5,
    ) -> dict[str, Any]:
        """Summarize which issues Atlas represents for a place."""
        service = AtlasDataService(get_settings().database_url)
        return await service.get_place_issue_signals(
            place,
            issue_areas=issue_areas,
            top_entities_per_issue=top_entities_per_issue,
        )

    @mcp.tool()
    async def get_related_entities(
        entity_id: str,
        relation_types: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Return mechanically derived relationships for an entity."""
        service = AtlasDataService(get_settings().database_url)
        return await service.get_related_entities(
            entity_id,
            relation_types=relation_types,
            limit=limit,
        )

    @mcp.tool()
    async def resolve_issue_areas(text: str, limit: int = 10) -> dict[str, Any]:
        """Resolve free-text into ranked Atlas issue area slugs."""
        service = AtlasDataService(get_settings().database_url)
        return await service.resolve_issue_areas(text, limit=limit)

    return mcp


_mcp: FastMCP | None = None


def get_mcp() -> FastMCP:
    """Return the process-wide FastMCP singleton, building it on first access."""
    global _mcp  # noqa: PLW0603
    if _mcp is None:
        _mcp = build_mcp()
    return _mcp


def get_mcp_asgi_app() -> Starlette:
    """Return the Streamable HTTP Starlette app for mounting on FastAPI."""
    return get_mcp().streamable_http_app()


@contextlib.asynccontextmanager
async def mcp_session_lifespan() -> AsyncIterator[None]:
    """Run the FastMCP session manager for the lifetime of the host app.

    The session manager must be running before any request reaches the
    Streamable HTTP transport; otherwise tool calls fail because the manager
    has no state to schedule against.
    """
    async with get_mcp().session_manager.run():
        yield
