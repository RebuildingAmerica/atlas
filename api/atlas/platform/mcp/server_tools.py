"""Atlas MCP tool registrar."""

from __future__ import annotations

from typing import Any

from atlas_shared import DiscoveryRunArtifacts  # noqa: TC002
from mcp.server.fastmcp import Context, FastMCP

from atlas.domains.access.models.watches import (  # noqa: TC001
    WatchNotificationPreference,
    WatchResourceType,
)

from .logging_support import install_logging_extension
from .prompts import install_prompts
from .resources import install_data_resources
from .server_transport import build_transport_security_settings
from .tasks import install_tasks_extension
from .widgets import (
    CONNECTIONS_GRAPH_RESOURCE_URI,
    ENTITY_CARD_RESOURCE_URI,
    SEARCH_RESULTS_RESOURCE_URI,
    install_widget_extension,
)


def build_mcp() -> FastMCP:  # noqa: PLR0915
    """Construct a FastMCP server with Atlas's tools, resources, Tasks, and logging."""
    from .server import (
        _build_data_service,
        _open_api_key_settings_url,
        _open_billing_settings_url,
        _require_api_key_settings_url,
        clarify_place_argument,
        clarify_resolve_issue_areas_result,
        clarify_search_entities_arguments,
        create_coverage_target_handoff,
        create_research_brief_handoff,
        export_coverage_report_handoff,
        export_research_brief_handoff,
        get_settings,
        save_entities_to_list_handoff,
        sync_scout_artifacts_handoff,
        watch_workspace_resource_handoff,
    )

    settings = get_settings()
    mcp = FastMCP(
        "Atlas",
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
        transport_security=build_transport_security_settings(settings),
    )

    @mcp.tool(meta={"ui": {"resourceUri": SEARCH_RESULTS_RESOURCE_URI}})
    async def search_entities(  # noqa: PLR0913
        place: str | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        entity_types: list[str] | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Search Atlas entities by place, issue area, and free-text query."""
        service = _build_data_service()
        arguments = await clarify_search_entities_arguments(
            ctx,
            place=place,
            issue_areas=issue_areas,
            text=text,
            entity_types=entity_types,
            source_types=source_types,
            limit=limit,
            cursor=cursor,
        )
        return await service.search_entities(**arguments)

    @mcp.tool(meta={"ui": {"resourceUri": ENTITY_CARD_RESOURCE_URI}})
    async def get_entity(entity_id: str) -> dict[str, Any]:
        """Get one Atlas entity with its sources, issue areas, and relationship ids."""
        service = _build_data_service()
        return await service.get_entity(entity_id)

    @mcp.tool()
    async def get_entity_sources(
        entity_id: str, limit: int = 20, cursor: str | None = None
    ) -> dict[str, Any]:
        """Return the public sources backing one Atlas entity."""
        service = _build_data_service()
        return await service.get_entity_sources(entity_id, limit=limit, cursor=cursor)

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
        service = _build_data_service()
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
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Get entities Atlas tracks for a specific place."""
        service = _build_data_service()
        place = await clarify_place_argument(ctx, place=place)
        arguments = await clarify_search_entities_arguments(
            ctx,
            place=place,
            issue_areas=issue_areas,
            text=text,
            entity_types=entity_types,
            source_types=source_types,
            limit=limit,
            cursor=cursor,
            allow_place_scoped_clarification=True,
        )
        return await service.search_entities(**arguments)

    @mcp.tool()
    async def list_discovery_runs(
        state: str | None = None,
        status: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """List source-linked Atlas research runs and their structured outputs."""
        service = _build_data_service()
        return await service.list_discovery_runs(
            state=state,
            status=status,
            limit=limit,
            cursor=cursor,
        )

    @mcp.tool()
    async def get_discovery_run(run_id: str) -> dict[str, Any]:
        """Get one source-linked Atlas research run and its structured output."""
        service = _build_data_service()
        return await service.get_discovery_run(run_id)

    @mcp.tool()
    async def get_place_profile(
        place: str,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Return demographic and socioeconomic context for a place."""
        service = _build_data_service()
        place = await clarify_place_argument(ctx, place=place)
        return await service.get_place_profile(place)

    @mcp.tool()
    async def get_place_coverage(
        place: str,
        issue_areas: list[str] | None = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Summarize Atlas coverage gaps and entity counts for a place."""
        service = _build_data_service()
        place = await clarify_place_argument(ctx, place=place)
        return await service.get_place_coverage(place, issue_areas=issue_areas)

    @mcp.tool()
    async def get_place_issue_signals(
        place: str,
        issue_areas: list[str] | None = None,
        top_entities_per_issue: int = 5,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Summarize which issues Atlas represents for a place."""
        service = _build_data_service()
        place = await clarify_place_argument(ctx, place=place)
        return await service.get_place_issue_signals(
            place,
            issue_areas=issue_areas,
            top_entities_per_issue=top_entities_per_issue,
        )

    @mcp.tool(meta={"ui": {"resourceUri": CONNECTIONS_GRAPH_RESOURCE_URI}})
    async def get_related_entities(
        entity_id: str,
        relation_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Return mechanically derived relationships for an entity."""
        service = _build_data_service()
        return await service.get_related_entities(
            entity_id,
            relation_types=relation_types,
            limit=limit,
            cursor=cursor,
        )

    @mcp.tool()
    async def resolve_issue_areas(
        text: str,
        limit: int = 10,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Resolve free-text into ranked Atlas issue area slugs."""
        service = _build_data_service()
        payload = await service.resolve_issue_areas(text, limit=limit)
        return await clarify_resolve_issue_areas_result(ctx, payload)

    @mcp.tool()
    async def open_billing_settings(
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Open Atlas billing settings through URL-mode elicitation."""
        return await _open_billing_settings_url(ctx=ctx, settings=get_settings())

    @mcp.tool()
    async def open_api_key_settings(
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Open Atlas API key settings through URL-mode elicitation."""
        return await _open_api_key_settings_url(ctx=ctx, settings=get_settings())

    @mcp.tool()
    async def require_api_key_settings(
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Require Atlas API key settings completion before continuing."""
        return await _require_api_key_settings_url(ctx=ctx, settings=get_settings())

    @mcp.tool()
    async def save_entities_to_list(
        list_id: str,
        entry_ids: list[str],
        note: str | None = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Save selected Atlas actors to an existing saved list after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await save_entities_to_list_handoff(
            ctx,
            list_id=list_id,
            entry_ids=entry_ids,
            note=note,
        )

    @mcp.tool()
    async def create_coverage_target(  # noqa: PLR0913
        name: str,
        geography: str,
        issue_areas: list[str],
        actor_types: list[str],
        source_types: list[str],
        linked_discovery_run_ids: list[str] | None = None,
        linked_entry_ids: list[str] | None = None,
        gaps: list[dict[str, str]] | None = None,
        next_actions: list[str] | None = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a private workspace coverage target after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await create_coverage_target_handoff(
            ctx,
            name=name,
            geography=geography,
            issue_areas=issue_areas,
            actor_types=actor_types,
            source_types=source_types,
            linked_discovery_run_ids=linked_discovery_run_ids,
            linked_entry_ids=linked_entry_ids,
            gaps=gaps,
            next_actions=next_actions,
        )

    @mcp.tool()
    async def create_research_brief(  # noqa: PLR0913
        title: str,
        scope: dict[str, Any],
        summary: str,
        linked_entry_ids: list[str] | None = None,
        linked_source_ids: list[str] | None = None,
        linked_discovery_run_ids: list[str] | None = None,
        confidence_summary: dict[str, Any] | None = None,
        gaps: list[dict[str, Any]] | None = None,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a private workspace research brief after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await create_research_brief_handoff(
            ctx,
            title=title,
            scope=scope,
            summary=summary,
            linked_entry_ids=linked_entry_ids,
            linked_source_ids=linked_source_ids,
            linked_discovery_run_ids=linked_discovery_run_ids,
            confidence_summary=confidence_summary,
            gaps=gaps,
        )

    @mcp.tool()
    async def export_research_brief(
        brief_id: str,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Export a private workspace research brief after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await export_research_brief_handoff(ctx, brief_id=brief_id)

    @mcp.tool()
    async def export_coverage_report(
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Export the active workspace coverage report after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await export_coverage_report_handoff(ctx)

    @mcp.tool()
    async def sync_scout_artifacts(
        artifacts: DiscoveryRunArtifacts,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Sync reviewed Scout artifacts to the active workspace after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await sync_scout_artifacts_handoff(ctx, artifacts=artifacts)

    @mcp.tool()
    async def watch_workspace_resource(
        resource_type: WatchResourceType,
        resource_id: str,
        notification_preference: WatchNotificationPreference = "digest",
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Watch an Atlas workspace resource after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {"status": "disabled", "message": "MCP Workbench handoffs are disabled."}
        return await watch_workspace_resource_handoff(
            ctx,
            resource_type=resource_type,
            resource_id=resource_id,
            notification_preference=notification_preference,
        )

    install_tasks_extension(mcp)
    install_logging_extension(mcp)
    install_prompts(mcp)
    install_widget_extension(mcp)
    install_data_resources(mcp, _build_data_service)
    return mcp
