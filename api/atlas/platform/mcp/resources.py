"""Atlas MCP data resources: durable context artifacts for clients.

This module is intentionally separate from ``widgets.py``. Both use MCP
resources, but they serve different product jobs: ``ui://atlas/...`` resources
are MCP Apps UI bundles, while ``atlas://...`` resources are trusted research
artifacts that clients can pin, re-read, and include as context.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from mcp.types import Annotations, Resource

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

    from atlas.platform.mcp.data import AtlasDataService

__all__ = [
    "ATLAS_RESOURCE_TEMPLATE_URIS",
    "DISCOVERY_RUN_BRIEF_MIME_TYPE",
    "install_data_resources",
]

DISCOVERY_RUN_BRIEF_MIME_TYPE = "text/markdown"
_JSON_MIME_TYPE = "application/json"
_RESOURCE_SHELF_LIMIT = 5
_CITY_KEY_PART_COUNT = 2
_logger = logging.getLogger(__name__)

ATLAS_RESOURCE_TEMPLATE_URIS = (
    "atlas://discovery-runs/{run_id}",
    "atlas://discovery-runs/{run_id}/brief",
    "atlas://discovery-runs/{run_id}/sources",
    "atlas://entities/{entity_id}/sources",
    "atlas://cities/{place_key}/coverage",
    "atlas://states/{state}/coverage",
)
"""Parameterized Atlas data resources exposed to MCP clients."""


DataServiceFactory = Callable[[], "AtlasDataService"]


@dataclass(frozen=True)
class ShelfResourceMetadata:
    """Metadata needed to present one resource in the bounded MCP shelf."""

    uri: str
    name: str
    title: str
    description: str
    mime_type: str
    priority: float
    last_modified: str | None


def _artifact_annotations(
    *, priority: float = 0.8, last_modified: str | None = None
) -> Annotations:
    """Return shared annotations for user-visible Atlas research artifacts."""
    annotation_data: dict[str, Any] = {"audience": ["user", "assistant"], "priority": priority}
    if last_modified:
        annotation_data["lastModified"] = last_modified
    return Annotations.model_validate(annotation_data)


def _resource(metadata: ShelfResourceMetadata) -> Resource:
    """Build an MCP resource definition for the bounded research shelf."""
    return Resource(
        uri=metadata.uri,
        name=metadata.name,
        title=metadata.title,
        description=metadata.description,
        mimeType=metadata.mime_type,
        annotations=_artifact_annotations(
            priority=metadata.priority,
            last_modified=metadata.last_modified,
        ),
    )


def _run_last_modified(run: dict[str, Any]) -> str | None:
    """Return the best timestamp for a discovery-run resource."""
    return run.get("completed_at") or run.get("created_at") or run.get("started_at")


def _run_title(run: dict[str, Any], suffix: str | None = None) -> str:
    """Return a readable title for a discovery-run artifact."""
    base = str(run.get("location_query") or run["id"])
    if suffix:
        return f"{suffix}: {base}"
    return f"Research run: {base}"


def _run_brief_markdown(run: dict[str, Any]) -> str:
    """Render a completed discovery run as concise source-aware Markdown."""
    summary = run.get("research_summary") or {}
    lines = [
        f"# Research brief: {run.get('location_query') or run['id']}",
        "",
        str(summary.get("brief") or "No brief available."),
    ]

    ranked_leads = summary.get("ranked_leads") or []
    if ranked_leads:
        lines.extend(["", "## Leads"])
        for lead in ranked_leads:
            name = lead.get("name") or lead.get("entry_id") or "Unknown lead"
            why = lead.get("why_it_matters") or "No summary available."
            source_count = lead.get("source_count")
            source_note = f" ({source_count} sources)" if source_count is not None else ""
            lines.append(f"- **{name}**{source_note}: {why}")

    key_sources = summary.get("key_sources") or []
    if key_sources:
        lines.extend(["", "## Sources"])
        for source in key_sources:
            title = source.get("title") or source.get("url") or "Untitled source"
            url = source.get("url")
            if url:
                lines.append(f"- [{title}]({url})")
            else:
                lines.append(f"- {title}")

    gaps = summary.get("gaps") or []
    if gaps:
        lines.extend(["", "## Gaps"])
        for gap in gaps:
            label = gap.get("label") or "Coverage gap"
            detail = gap.get("detail") or "No detail available."
            lines.append(f"- **{label}**: {detail}")

    return "\n".join(lines).strip() + "\n"


def _run_summary_sources(run: dict[str, Any]) -> dict[str, Any]:
    """Return sources referenced by a run summary."""
    summary = run.get("research_summary") or {}
    return {
        "run_id": run["id"],
        "resource_uri": f"atlas://discovery-runs/{run['id']}/sources",
        "sources": summary.get("key_sources") or [],
    }


def _place_from_city_key(place_key: str) -> str:
    """Convert an Atlas city resource key like ``gary-in`` into a place query."""
    parts = place_key.rsplit("-", 1)
    if len(parts) != _CITY_KEY_PART_COUNT:
        msg = f"Invalid city place key: {place_key}"
        raise ValueError(msg)
    city, state = parts
    return f"{city.replace('-', ' ').title()}, {state.upper()}"


async def _completed_run_shelf_resources(
    data_service_factory: DataServiceFactory,
) -> list[Resource]:
    """Return bounded recent completed-run resources for resources/list."""
    service = data_service_factory()
    collection = await service.list_discovery_runs(status="completed", limit=_RESOURCE_SHELF_LIMIT)
    resources: list[Resource] = []
    for index, run in enumerate(collection.get("items", [])):
        priority = max(0.5, 0.95 - (index * 0.05))
        last_modified = _run_last_modified(run)
        run_uri = f"atlas://discovery-runs/{run['id']}"
        brief_uri = f"{run_uri}/brief"
        resources.append(
            _resource(
                ShelfResourceMetadata(
                    uri=run_uri,
                    name=f"discovery_run_{run['id']}",
                    title=_run_title(run),
                    description="Source-linked Atlas research run.",
                    mime_type=_JSON_MIME_TYPE,
                    priority=priority,
                    last_modified=last_modified,
                )
            )
        )
        resources.append(
            _resource(
                ShelfResourceMetadata(
                    uri=brief_uri,
                    name=f"discovery_run_{run['id']}_brief",
                    title=_run_title(run, "Research brief"),
                    description="Source-linked Atlas research brief.",
                    mime_type=DISCOVERY_RUN_BRIEF_MIME_TYPE,
                    priority=priority,
                    last_modified=last_modified,
                )
            )
        )
    return resources


def _install_resource_templates(mcp: FastMCP, data_service_factory: DataServiceFactory) -> None:
    """Register addressable Atlas data-resource templates."""

    @mcp.resource(
        "atlas://discovery-runs/{run_id}",
        name="discovery_run",
        title="Discovery Run",
        description="Full structured Atlas discovery-run record.",
        mime_type=_JSON_MIME_TYPE,
        annotations=_artifact_annotations(priority=0.85),
    )
    async def discovery_run(run_id: str) -> dict[str, Any]:
        service = data_service_factory()
        return await service.get_discovery_run(run_id)

    @mcp.resource(
        "atlas://discovery-runs/{run_id}/brief",
        name="discovery_run_brief",
        title="Discovery Run Brief",
        description="Human-readable source-linked Atlas research brief.",
        mime_type=DISCOVERY_RUN_BRIEF_MIME_TYPE,
        annotations=_artifact_annotations(priority=0.95),
    )
    async def discovery_run_brief(run_id: str) -> str:
        service = data_service_factory()
        run = await service.get_discovery_run(run_id)
        return _run_brief_markdown(run)

    @mcp.resource(
        "atlas://discovery-runs/{run_id}/sources",
        name="discovery_run_sources",
        title="Discovery Run Sources",
        description="Sources referenced by an Atlas discovery-run summary.",
        mime_type=_JSON_MIME_TYPE,
        annotations=_artifact_annotations(priority=0.8),
    )
    async def discovery_run_sources(run_id: str) -> dict[str, Any]:
        service = data_service_factory()
        run = await service.get_discovery_run(run_id)
        return _run_summary_sources(run)

    @mcp.resource(
        "atlas://entities/{entity_id}/sources",
        name="entity_source_trail",
        title="Entity Source Trail",
        description="Public source trail for one Atlas entity.",
        mime_type=_JSON_MIME_TYPE,
        annotations=_artifact_annotations(priority=0.9),
    )
    async def entity_sources(entity_id: str) -> dict[str, Any]:
        service = data_service_factory()
        return await service.get_entity_sources(entity_id)

    @mcp.resource(
        "atlas://cities/{place_key}/coverage",
        name="city_coverage",
        title="City Coverage Summary",
        description="Atlas coverage summary for one city.",
        mime_type=_JSON_MIME_TYPE,
        annotations=_artifact_annotations(priority=0.75),
    )
    async def city_coverage(place_key: str) -> dict[str, Any]:
        service = data_service_factory()
        return await service.get_place_coverage(_place_from_city_key(place_key))

    @mcp.resource(
        "atlas://states/{state}/coverage",
        name="state_coverage",
        title="State Coverage Summary",
        description="Atlas coverage summary for one state.",
        mime_type=_JSON_MIME_TYPE,
        annotations=_artifact_annotations(priority=0.7),
    )
    async def state_coverage(state: str) -> dict[str, Any]:
        service = data_service_factory()
        return await service.get_place_coverage(state.upper())


def _install_resource_shelf(mcp: FastMCP, data_service_factory: DataServiceFactory) -> None:
    """Extend FastMCP's concrete resource list with bounded Atlas data artifacts."""
    original_list_resources = mcp.list_resources

    async def list_resources_with_atlas_shelf() -> list[Resource]:
        listed = await original_list_resources()
        try:
            shelf = await _completed_run_shelf_resources(data_service_factory)
        except Exception:
            _logger.exception("Failed to build Atlas MCP resource shelf.")
            return listed
        listed_uris = {str(resource.uri) for resource in listed}
        return [*listed, *(resource for resource in shelf if str(resource.uri) not in listed_uris)]

    mcp.list_resources = list_resources_with_atlas_shelf  # type: ignore[method-assign]
    low_level_server = cast("Any", mcp._mcp_server)  # noqa: SLF001
    low_level_server.list_resources()(mcp.list_resources)


def install_data_resources(mcp: FastMCP, data_service_factory: DataServiceFactory) -> None:
    """Wire Atlas data resources and the bounded resource shelf onto the MCP server."""
    _install_resource_templates(mcp, data_service_factory)
    _install_resource_shelf(mcp, data_service_factory)
