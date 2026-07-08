"""Workbench public handoff functions."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from importlib import import_module
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    import aiosqlite
    from atlas_shared import DiscoveryRunArtifacts

from .workbench_confirmation import _confirm_saved_list_write
from .workbench_models import (
    SaveEntitiesToListRequest,
    WatchNotificationPreference,
    WatchResourceType,
    WorkbenchElicitationContext,
    _actor_claims_from_context,
    _request_meta_from_context,
)
from .workbench_requests import (
    _coverage_report_export_request_from_context,
    _coverage_target_request_from_context,
    _research_brief_export_request_from_context,
    _research_brief_request_from_context,
    _scout_artifacts_sync_request_from_context,
    _watch_request_from_context,
)


def _workbench_module() -> Any:
    return import_module("atlas.platform.mcp.workbench")


type WorkbenchStorageDelegate = Callable[[Any, object], Awaitable[dict[str, Any]]]


def _storage_delegate(workbench_module: Any, name: str) -> WorkbenchStorageDelegate:
    return cast("WorkbenchStorageDelegate", getattr(workbench_module, name))


async def save_entities_to_list(
    ctx: WorkbenchElicitationContext | None,
    *,
    list_id: str,
    entry_ids: list[str],
    note: str | None = None,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and save selected actors to an existing Atlas saved list."""
    workbench_module = _workbench_module()
    if not workbench_module.declares_form_elicitation(_request_meta_from_context(ctx)):
        await workbench_module.log_elicitation_event(
            interaction="workbench_save_list",
            mode="form",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": "This MCP client cannot confirm saved-list writes.",
        }
    if ctx is None:
        await workbench_module.log_elicitation_event(
            interaction="workbench_save_list",
            mode="form",
            action="unavailable",
        )
        return {
            "status": "unavailable",
            "message": "Atlas could not confirm this workspace action.",
        }

    user_id, org_id = _actor_claims_from_context(ctx)
    if user_id is None:
        return {"status": "unauthenticated", "message": "Atlas could not identify the MCP user."}

    confirmation, stop_action = await _confirm_saved_list_write(ctx)
    if confirmation is None:
        return {
            "status": stop_action,
            "message": "No actors were saved to the list.",
        }
    request = SaveEntitiesToListRequest(
        user_id=user_id,
        org_id=org_id,
        list_id=list_id,
        entry_ids=entry_ids,
        note=note,
        confirmation=confirmation,
    )

    if db is not None:
        return await _storage_delegate(workbench_module, "_save_entities_to_list_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_save_entities_to_list_with_db")(
            conn, request
        )
    finally:
        await conn.close()


async def export_research_brief(
    ctx: WorkbenchElicitationContext | None,
    *,
    brief_id: str,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and export a private workspace research brief."""
    workbench_module = _workbench_module()
    request, error = await _research_brief_export_request_from_context(ctx, brief_id=brief_id)
    if error is not None:
        return error
    assert request is not None, "brief export request builder returns request or error"

    if db is not None:
        return await _storage_delegate(workbench_module, "_export_research_brief_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_export_research_brief_with_db")(
            conn, request
        )
    finally:
        await conn.close()


async def export_coverage_report(
    ctx: WorkbenchElicitationContext | None,
    *,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and export a private workspace coverage report."""
    workbench_module = _workbench_module()
    request, error = await _coverage_report_export_request_from_context(ctx)
    if error is not None:
        return error
    assert request is not None, "coverage report request builder returns request or error"

    if db is not None:
        return await _storage_delegate(workbench_module, "_export_coverage_report_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_export_coverage_report_with_db")(
            conn, request
        )
    finally:
        await conn.close()


async def sync_scout_artifacts(
    ctx: WorkbenchElicitationContext | None,
    *,
    artifacts: DiscoveryRunArtifacts,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and sync reviewed Scout artifacts into the active workspace."""
    workbench_module = _workbench_module()
    request, error = await _scout_artifacts_sync_request_from_context(ctx, artifacts=artifacts)
    if error is not None:
        return error
    assert request is not None, "Scout artifact sync request builder returns request or error"

    if db is not None:
        return await _storage_delegate(workbench_module, "_sync_scout_artifacts_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_sync_scout_artifacts_with_db")(
            conn, request
        )
    finally:
        await conn.close()


async def create_research_brief(  # noqa: PLR0913
    ctx: WorkbenchElicitationContext | None,
    *,
    title: str,
    scope: dict[str, Any],
    summary: str,
    linked_entry_ids: list[str] | None = None,
    linked_source_ids: list[str] | None = None,
    linked_discovery_run_ids: list[str] | None = None,
    confidence_summary: dict[str, Any] | None = None,
    gaps: list[dict[str, Any]] | None = None,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and create a private workspace research brief."""
    workbench_module = _workbench_module()
    request, error = await _research_brief_request_from_context(
        ctx,
        title=title,
        scope=scope,
        summary=summary,
        linked_entry_ids=list(linked_entry_ids or []),
        linked_source_ids=list(linked_source_ids or []),
        linked_discovery_run_ids=list(linked_discovery_run_ids or []),
        confidence_summary=dict(confidence_summary or {}),
        gaps=list(gaps or []),
    )
    if error is not None:
        return error
    assert request is not None, "brief request builder returns request or error"

    if db is not None:
        return await _storage_delegate(workbench_module, "_create_research_brief_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_create_research_brief_with_db")(
            conn, request
        )
    finally:
        await conn.close()


async def create_coverage_target(  # noqa: PLR0913
    ctx: WorkbenchElicitationContext | None,
    *,
    name: str,
    geography: str,
    issue_areas: list[str],
    actor_types: list[str],
    source_types: list[str],
    linked_discovery_run_ids: list[str] | None = None,
    linked_entry_ids: list[str] | None = None,
    gaps: list[dict[str, str]] | None = None,
    next_actions: list[str] | None = None,
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and create a private workspace coverage target."""
    workbench_module = _workbench_module()
    request, error = await _coverage_target_request_from_context(
        ctx,
        name=name,
        geography=geography,
        issue_areas=issue_areas,
        actor_types=actor_types,
        source_types=source_types,
        linked_discovery_run_ids=list(linked_discovery_run_ids or []),
        linked_entry_ids=list(linked_entry_ids or []),
        gaps=list(gaps or []),
        next_actions=list(next_actions or []),
    )
    if error is not None:
        return error
    assert request is not None, "coverage target request builder returns request or error"

    if db is not None:
        return await _storage_delegate(workbench_module, "_create_coverage_target_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_create_coverage_target_with_db")(
            conn, request
        )
    finally:
        await conn.close()


async def watch_workspace_resource(
    ctx: WorkbenchElicitationContext | None,
    *,
    resource_type: WatchResourceType,
    resource_id: str,
    notification_preference: WatchNotificationPreference = "digest",
    db: aiosqlite.Connection | None = None,
) -> dict[str, Any]:
    """Confirm and watch an Atlas workspace resource."""
    workbench_module = _workbench_module()
    request, error = await _watch_request_from_context(
        ctx,
        resource_type=resource_type,
        resource_id=resource_id,
        notification_preference=notification_preference,
    )
    if error is not None:
        return error
    assert request is not None, "watch request builder returns request or error"

    if db is not None:
        return await _storage_delegate(workbench_module, "_watch_workspace_resource_with_db")(
            db, request
        )

    settings = workbench_module.get_settings()
    conn = await workbench_module.get_db_connection(
        settings.database_url, backend=settings.database_backend
    )
    try:
        return await _storage_delegate(workbench_module, "_watch_workspace_resource_with_db")(
            conn, request
        )
    finally:
        await conn.close()
