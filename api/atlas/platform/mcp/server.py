"""FastMCP server exposing Atlas catalog tools over Streamable HTTP."""

from __future__ import annotations

import contextlib
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from atlas_shared import DiscoveryRunArtifacts  # noqa: TC002
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.middleware.cors import CORSMiddleware

from atlas.domains.access.models.watches import (  # noqa: TC001
    WatchNotificationPreference,
    WatchResourceType,
)
from atlas.platform.config import Settings, get_settings

from .auth_middleware import McpBearerAuthMiddleware, _string_claim
from .data import AtlasDataService
from .elicitation import (
    build_first_party_elicitation_url,
    build_url_elicitation_request,
    build_url_elicitation_required_error,
    clarify_place_argument,
    clarify_resolve_issue_areas_result,
    clarify_search_entities_arguments,
    create_url_elicitation_state,
    declares_url_elicitation,
    has_completed_url_elicitation,
    log_elicitation_event,
)
from .logging_support import install_logging_extension
from .prompts import install_prompts
from .resources import install_data_resources
from .tasks import DraftTasksJsonRpcMiddleware, install_tasks_extension
from .widgets import (
    CONNECTIONS_GRAPH_RESOURCE_URI,
    ENTITY_CARD_RESOURCE_URI,
    SEARCH_RESULTS_RESOURCE_URI,
    install_widget_extension,
)
from .workbench import (
    create_coverage_target as create_coverage_target_handoff,
)
from .workbench import (
    create_research_brief as create_research_brief_handoff,
)
from .workbench import (
    export_coverage_report as export_coverage_report_handoff,
)
from .workbench import (
    export_research_brief as export_research_brief_handoff,
)
from .workbench import (
    save_entities_to_list as save_entities_to_list_handoff,
)
from .workbench import (
    sync_scout_artifacts as sync_scout_artifacts_handoff,
)
from .workbench import (
    watch_workspace_resource as watch_workspace_resource_handoff,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterable

    from starlette.applications import Starlette

__all__ = [
    "build_mcp",
    "build_transport_security_settings",
    "get_mcp",
    "get_mcp_asgi_app",
    "mcp_session_lifespan",
    "split_cors_origins",
]

LOCAL_ALLOWED_HOSTS = ["127.0.0.1:*", "localhost:*", "[::1]:*"]
LOCAL_ALLOWED_ORIGINS = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]

_CORS_WILDCARD_PORT_SUFFIX = ":*"
_CORS_ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
"""Streamable HTTP only needs GET (SSE listen) and POST (JSON-RPC calls); the
server runs stateless so there's no session to DELETE. OPTIONS is required
for CORS preflight itself."""


@dataclass(frozen=True)
class AccountElicitationFlow:
    """User-facing copy and routing metadata for account URL handoffs."""

    interaction: str
    target_flow: str
    target_path: str
    request_message: str
    fallback_message: str
    declined_message: str
    accepted_message: str
    unavailable_message: str


API_KEY_SETTINGS_FLOW = AccountElicitationFlow(
    interaction="api_key_settings_url",
    target_flow="api_key_settings",
    target_path="/account",
    request_message="Open Atlas account settings to manage API keys.",
    fallback_message="Open Atlas account settings to manage API keys.",
    declined_message="Atlas API key settings were not opened.",
    accepted_message="Atlas API key settings opened in the browser.",
    unavailable_message="Atlas account settings are unavailable right now.",
)

BILLING_SETTINGS_FLOW = AccountElicitationFlow(
    interaction="billing_settings_url",
    target_flow="billing_settings",
    target_path="/account",
    request_message="Open Atlas account settings to manage billing.",
    fallback_message="Open Atlas account settings to manage billing.",
    declined_message="Atlas billing settings were not opened.",
    accepted_message="Atlas billing settings opened in the browser.",
    unavailable_message="Atlas account settings are unavailable right now.",
)


def _origin_and_host(value: str) -> tuple[str | None, str | None]:
    parsed = urlsplit(value.rstrip("/"))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None, None
    return f"{parsed.scheme}://{parsed.netloc}", parsed.netloc


def _atlas_public_origin(settings: Settings) -> str | None:
    """Return Atlas's public app origin, derived from the configured auth issuer.

    `settings.auth_jwt_issuer` is sourced from `ATLAS_PUBLIC_URL` and has the
    auth service's `/api/auth` suffix appended during settings normalization;
    stripping it back off recovers the frontend app's public base URL.
    """
    origin = settings.auth_jwt_issuer.removesuffix("/api/auth")
    return origin or None


def _build_data_service() -> AtlasDataService:
    """Construct an AtlasDataService wired with the current request's settings.

    Centralizing this in one helper (rather than repeating it per tool)
    avoids inflating each tool body from one statement to two, which would
    push `build_mcp()` over its statement-count lint budget.
    """
    settings = get_settings()
    return AtlasDataService(settings.database_url, public_url=_atlas_public_origin(settings))


def _actor_claims_from_context(ctx: Context[Any, Any, Any] | None) -> tuple[str | None, str | None]:
    """Return (org_id, user_id) from the verified MCP request payload."""
    if ctx is None:
        return None, None
    try:
        request = ctx.request_context.request
    except ValueError:
        return None, None
    if request is None:
        return None, None
    payload = getattr(request.state, "mcp_auth_payload", None)
    return _string_claim(payload, "org_id"), _string_claim(payload, "sub")


def _request_context_and_meta(
    ctx: Context[Any, Any, Any] | None,
) -> tuple[Any | None, object | None]:
    try:
        request_context = ctx.request_context if ctx is not None else None
        request_meta = request_context.meta if request_context is not None else None
    except ValueError:
        return None, None
    return request_context, request_meta


def _create_account_elicitation_state(
    *,
    ctx: Context[Any, Any, Any] | None,
    target_flow: str,
    target_url: str = "/account",
) -> Any:
    org_id, user_id = _actor_claims_from_context(ctx)
    request_context, _request_meta = _request_context_and_meta(ctx)
    return create_url_elicitation_state(
        user_id=user_id,
        org_id=org_id,
        target_flow=target_flow,
        target_url=target_url,
        session=getattr(request_context, "session", None),
    )


async def _open_account_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
    flow: AccountElicitationFlow,
) -> dict[str, Any]:
    """Use URL-mode elicitation to open a first-party Atlas account surface."""
    public_origin = _atlas_public_origin(settings)
    if public_origin is None:
        return {
            "status": "unavailable",
            "message": flow.unavailable_message,
        }
    if not settings.mcp_url_elicitation_enabled:
        await log_elicitation_event(
            interaction=flow.interaction,
            mode="url",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": flow.fallback_message,
            "path": flow.target_path,
        }

    _request_context, request_meta = _request_context_and_meta(ctx)

    if not declares_url_elicitation(request_meta):
        await log_elicitation_event(
            interaction=flow.interaction,
            mode="url",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": flow.fallback_message,
            "path": flow.target_path,
        }

    assert ctx is not None
    state = _create_account_elicitation_state(
        ctx=ctx,
        target_flow=flow.target_flow,
        target_url=flow.target_path,
    )
    url = build_first_party_elicitation_url(
        public_url=public_origin,
        path=flow.target_path,
        elicitation_id=state.elicitation_id,
    )
    await log_elicitation_event(
        interaction=flow.interaction,
        mode="url",
        action="requested",
    )
    result = await ctx.elicit_url(
        message=flow.request_message,
        url=url,
        elicitation_id=state.elicitation_id,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction=flow.interaction,
            mode="url",
            action=result.action,
        )
        return {
            "status": result.action,
            "message": flow.declined_message,
        }

    await log_elicitation_event(
        interaction=flow.interaction,
        mode="url",
        action="accept",
    )
    return {
        "status": "accepted",
        "message": flow.accepted_message,
        "elicitation_id": state.elicitation_id,
    }


async def _open_billing_settings_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
) -> dict[str, Any]:
    """Use URL-mode elicitation to open Atlas billing settings."""
    return await _open_account_url(
        ctx=ctx,
        settings=settings,
        flow=BILLING_SETTINGS_FLOW,
    )


async def _open_api_key_settings_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
) -> dict[str, Any]:
    """Use URL-mode elicitation to open Atlas API key settings."""
    return await _open_account_url(
        ctx=ctx,
        settings=settings,
        flow=API_KEY_SETTINGS_FLOW,
    )


async def _require_api_key_settings_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
) -> dict[str, Any]:
    """Require API-key setup to be completed through Atlas account settings."""
    public_origin = _atlas_public_origin(settings)
    if public_origin is None:
        return {
            "status": "unavailable",
            "message": API_KEY_SETTINGS_FLOW.unavailable_message,
        }
    request_context, request_meta = _request_context_and_meta(ctx)
    org_id, user_id = _actor_claims_from_context(ctx)
    if has_completed_url_elicitation(
        target_flow=API_KEY_SETTINGS_FLOW.target_flow,
        user_id=user_id,
        org_id=org_id,
    ):
        return {
            "status": "ready",
            "message": "Atlas API key settings are ready.",
            "path": "/account",
        }
    if not settings.mcp_url_elicitation_enabled or not declares_url_elicitation(request_meta):
        await log_elicitation_event(
            interaction=API_KEY_SETTINGS_FLOW.interaction,
            mode="url",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": API_KEY_SETTINGS_FLOW.fallback_message,
            "path": "/account",
        }

    state = create_url_elicitation_state(
        user_id=user_id,
        org_id=org_id,
        target_flow=API_KEY_SETTINGS_FLOW.target_flow,
        target_url="/account",
        session=getattr(request_context, "session", None),
    )
    url = build_first_party_elicitation_url(
        public_url=public_origin,
        path="/account",
        elicitation_id=state.elicitation_id,
    )
    await log_elicitation_event(
        interaction=API_KEY_SETTINGS_FLOW.interaction,
        mode="url",
        action="requested",
    )
    raise build_url_elicitation_required_error(
        message="Atlas API key setup must be completed in the browser.",
        elicitations=[
            build_url_elicitation_request(
                message=API_KEY_SETTINGS_FLOW.request_message,
                url=url,
                elicitation_id=state.elicitation_id,
            )
        ],
    )


def build_transport_security_settings(settings: Settings) -> TransportSecuritySettings:
    """Build MCP host/origin allowlists from Atlas's configured public URLs.

    FastMCP enables a localhost-only host guard when its default host is
    `127.0.0.1`. Atlas mounts MCP inside a public FastAPI deployment, so the
    guard has to know the hosted app and API domains users actually reach.
    """
    allowed_hosts = set(LOCAL_ALLOWED_HOSTS)
    allowed_origins = set(LOCAL_ALLOWED_ORIGINS)

    configured_urls = [
        settings.auth_jwt_issuer.removesuffix("/api/auth"),
        *settings.auth_jwt_audience,
        *settings.cors_origins,
    ]
    for configured_url in configured_urls:
        if configured_url == "*":
            continue
        origin, host = _origin_and_host(configured_url)
        if origin:
            allowed_origins.add(origin)
        if host:
            allowed_hosts.add(host)

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=sorted(allowed_hosts),
        allowed_origins=sorted(allowed_origins),
    )


def split_cors_origins(allowed_origins: Iterable[str]) -> tuple[list[str], str | None]:
    """Split an MCP transport-security origin allowlist for `CORSMiddleware`.

    `build_transport_security_settings` computes an allowlist that mixes
    exact production origins (e.g. `https://atlas.example.com`) with
    wildcard-port local-dev patterns (`http://127.0.0.1:*`, from
    `LOCAL_ALLOWED_ORIGINS`). FastMCP's own transport-security guard
    understands that `:*` wildcard suffix, but `CORSMiddleware.allow_origins`
    only matches origins by exact string — passing it `"http://127.0.0.1:*"`
    verbatim would never match a real `Origin: http://127.0.0.1:5173` header.
    This derives a combined regex for `CORSMiddleware`'s
    `allow_origin_regex` from whichever entries in the allowlist end in
    `:*`, so local dev keeps working without hardcoding a second copy of
    `LOCAL_ALLOWED_ORIGINS`'s patterns.

    `main.py` also calls this for the outer FastAPI app's own CORS
    middleware, not just `get_mcp_asgi_app()`'s: Starlette applies a
    mounted sub-app's middleware only *after* the outer app's own
    middleware stack lets a request through, so a preflight `OPTIONS`
    request for `/mcp` is answered by the outer app's CORS middleware
    before it ever reaches the one `get_mcp_asgi_app()` adds. Both have to
    agree on the same wildcard-aware allowlist, or a local MCP host on an
    arbitrary port would pass `get_mcp_asgi_app()`'s check but still get
    rejected by the outer one first.

    Parameters
    ----------
    allowed_origins:
        The origin allowlist computed by `build_transport_security_settings`.

    Returns
    -------
    tuple[list[str], str | None]
        Exact origins for `allow_origins`, and a combined regex pattern for
        `allow_origin_regex` (`None` when the allowlist has no wildcard-port
        entries).
    """
    exact_origins: list[str] = []
    wildcard_patterns: list[str] = []
    for origin in allowed_origins:
        if origin.endswith(_CORS_WILDCARD_PORT_SUFFIX):
            prefix = re.escape(origin.removesuffix(_CORS_WILDCARD_PORT_SUFFIX))
            wildcard_patterns.append(rf"{prefix}:\d+")
        else:
            exact_origins.append(origin)

    if not wildcard_patterns:
        return exact_origins, None
    return exact_origins, "|".join(wildcard_patterns)


def build_mcp() -> FastMCP:  # noqa: PLR0915
    """Construct a FastMCP server with Atlas's tools, resources, Tasks, and logging.

    The server is configured for stateless Streamable HTTP so it can run behind
    a horizontally-scaled load balancer (Cloud Run) without sticky sessions.
    `streamable_http_path="/"` collapses the default `/mcp` suffix so the
    Streamable HTTP root sits directly at whatever mount point the host app
    chooses (Atlas mounts at `/mcp`). `install_tasks_extension` adds the one
    write/compute tool (`start_discovery_run`) plus its `tasks/*` handlers;
    `install_logging_extension` adds `logging/setLevel` and lets every custom
    handler emit structured `notifications/message` log events;
    `install_widget_extension` registers the MCP Apps UI resources that
    `get_entity`'s, `search_entities`'s, and `get_related_entities`'s `_meta`
    point a compliant host at; `install_data_resources` registers durable
    `atlas://...` research artifacts for clients to pin, re-read, and include as
    context without listing the whole catalog.
    """
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
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
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
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
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
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
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
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
        return await export_research_brief_handoff(ctx, brief_id=brief_id)

    @mcp.tool()
    async def export_coverage_report(
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Export the active workspace coverage report after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
        return await export_coverage_report_handoff(ctx)

    @mcp.tool()
    async def sync_scout_artifacts(
        artifacts: DiscoveryRunArtifacts,
        ctx: Context[Any, Any, Any] | None = None,
    ) -> dict[str, Any]:
        """Sync reviewed Scout artifacts to the active workspace after confirmation."""
        if not settings.mcp_workbench_handoffs_enabled:
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
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
            return {
                "status": "disabled",
                "message": "MCP Workbench handoffs are disabled.",
            }
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


_mcp: FastMCP | None = None


def get_mcp() -> FastMCP:
    """Return the process-wide FastMCP singleton, building it on first access."""
    global _mcp  # noqa: PLW0603
    if _mcp is None:
        _mcp = build_mcp()
    return _mcp


def get_mcp_asgi_app(
    transport_security: TransportSecuritySettings | None = None,
) -> Starlette:
    """Return the Streamable HTTP Starlette app for mounting on FastAPI.

    Wires the draft-Tasks JSON-RPC shim, the bearer-auth guard, and CORS
    support directly onto the returned app, in that order, rather than
    leaving the mounting caller to do it. `CORSMiddleware` has to sit
    *outside* `McpBearerAuthMiddleware`, or an unauthenticated preflight
    `OPTIONS` request — which never carries a bearer token, by construction
    of the CORS protocol — would be rejected with 401 by the auth guard
    before `CORSMiddleware` ever gets a chance to answer it, and a
    browser-based MCP host would never get past its own preflight to send a
    real request. `DraftTasksJsonRpcMiddleware` sits *inside* the auth guard
    so draft-Tasks JSON-RPC calls remain subject to authentication like any
    other MCP request. Starlette's `add_middleware` treats the
    most-recently-added middleware as outermost (it runs first on the way
    in), so middleware is added innermost-first: draft-Tasks, then auth,
    then CORS last.

    `streamable_http_app()` returns a fresh Starlette instance on every
    call, but this guards against re-adding middleware if a caller ever
    memoizes and re-passes the same app instance — Starlette raises once an
    app has already started handling requests.

    Parameters
    ----------
    transport_security:
        A precomputed `TransportSecuritySettings` to derive this app's CORS
        allowlist from. `create_app()` already computes one (for its own,
        outer CORS middleware — see `split_cors_origins`'s docstring for why
        both need to agree) and passes it through here to avoid deriving the
        same allowlist from `Settings` twice. Callers with no settings of
        their own (e.g. this module's own tests) can omit it; it's computed
        fresh from `get_settings()` in that case.
    """
    app = get_mcp().streamable_http_app()
    if not getattr(app.state, "atlas_mcp_asgi_middleware_installed", False):
        app.add_middleware(DraftTasksJsonRpcMiddleware)
        app.add_middleware(McpBearerAuthMiddleware)

        if transport_security is None:
            transport_security = build_transport_security_settings(get_settings())
        exact_origins, origin_regex = split_cors_origins(transport_security.allowed_origins)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=exact_origins,
            allow_origin_regex=origin_regex,
            allow_methods=_CORS_ALLOWED_METHODS,
            allow_headers=["*"],
        )
        app.state.atlas_mcp_asgi_middleware_installed = True
    return app


@contextlib.asynccontextmanager
async def mcp_session_lifespan() -> AsyncIterator[None]:
    """Run the FastMCP session manager for the lifetime of the host app.

    The session manager must be running before any request reaches the
    Streamable HTTP transport; otherwise tool calls fail because the manager
    has no state to schedule against.
    """
    async with get_mcp().session_manager.run():
        yield
