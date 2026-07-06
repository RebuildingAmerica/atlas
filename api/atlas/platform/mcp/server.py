"""FastMCP server exposing Atlas catalog tools over Streamable HTTP."""

from __future__ import annotations

import contextlib
import re
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.middleware.cors import CORSMiddleware

from atlas.platform.config import Settings, get_settings

from .auth_middleware import McpBearerAuthMiddleware
from .data import AtlasDataService
from .logging_support import install_logging_extension
from .prompts import install_prompts
from .tasks import DraftTasksJsonRpcMiddleware, install_tasks_extension
from .widgets import (
    ENTITY_CARD_RESOURCE_URI,
    SEARCH_RESULTS_RESOURCE_URI,
    install_widget_extension,
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


def build_mcp() -> FastMCP:
    """Construct a FastMCP server with Atlas's read tools, Tasks, and logging.

    The server is configured for stateless Streamable HTTP so it can run behind
    a horizontally-scaled load balancer (Cloud Run) without sticky sessions.
    `streamable_http_path="/"` collapses the default `/mcp` suffix so the
    Streamable HTTP root sits directly at whatever mount point the host app
    chooses (Atlas mounts at `/mcp`). `install_tasks_extension` adds the one
    write/compute tool (`start_discovery_run`) plus its `tasks/*` handlers;
    `install_logging_extension` adds `logging/setLevel` and lets every custom
    handler emit structured `notifications/message` log events;
    `install_widget_extension` registers the MCP Apps UI resources that
    `get_entity`'s and `search_entities`'s `_meta` point a compliant host at.
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
    ) -> dict[str, Any]:
        """Search Atlas entities by place, issue area, and free-text query."""
        service = _build_data_service()
        return await service.search_entities(
            place=place,
            issue_areas=issue_areas,
            text=text,
            entity_types=entity_types,
            source_types=source_types,
            limit=limit,
            cursor=cursor,
        )

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
    ) -> dict[str, Any]:
        """Get entities Atlas tracks for a specific place."""
        service = _build_data_service()
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
    async def get_place_profile(place: str) -> dict[str, Any]:
        """Return demographic and socioeconomic context for a place."""
        service = _build_data_service()
        return await service.get_place_profile(place)

    @mcp.tool()
    async def get_place_coverage(
        place: str,
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Summarize Atlas coverage gaps and entity counts for a place."""
        service = _build_data_service()
        return await service.get_place_coverage(place, issue_areas=issue_areas)

    @mcp.tool()
    async def get_place_issue_signals(
        place: str,
        issue_areas: list[str] | None = None,
        top_entities_per_issue: int = 5,
    ) -> dict[str, Any]:
        """Summarize which issues Atlas represents for a place."""
        service = _build_data_service()
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
    async def resolve_issue_areas(text: str, limit: int = 10) -> dict[str, Any]:
        """Resolve free-text into ranked Atlas issue area slugs."""
        service = _build_data_service()
        return await service.resolve_issue_areas(text, limit=limit)

    install_tasks_extension(mcp)
    install_logging_extension(mcp)
    install_prompts(mcp)
    install_widget_extension(mcp)
    return mcp


_mcp: FastMCP | None = None


def get_mcp() -> FastMCP:
    """Return the process-wide FastMCP singleton, building it on first access."""
    global _mcp  # noqa: PLW0603
    if _mcp is None:
        _mcp = build_mcp()
    return _mcp


def get_mcp_asgi_app() -> Starlette:
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
    """
    app = get_mcp().streamable_http_app()
    if not getattr(app.state, "atlas_mcp_asgi_middleware_installed", False):
        app.add_middleware(DraftTasksJsonRpcMiddleware)
        app.add_middleware(McpBearerAuthMiddleware)

        exact_origins, origin_regex = split_cors_origins(
            build_transport_security_settings(get_settings()).allowed_origins
        )
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
