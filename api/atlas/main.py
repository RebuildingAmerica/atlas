"""
FastAPI application entry point for The Atlas API.

Configures:
- CORS middleware
- Lifespan (startup/shutdown)
- Database initialization
- API routes
- Health check endpoint
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from functools import cache
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from atlas.config import get_settings, validate_runtime_auth_config
from atlas.models import init_db
from atlas.platform.http import create_router
from atlas.platform.http.anonymous_rate_limit import AnonymousRateLimitMiddleware
from atlas.platform.http.cache import apply_no_store_headers, apply_static_public_cache
from atlas.platform.mcp.server_transport import (
    build_transport_allowlists,
    build_transport_security_settings,
    split_cors_origins,
)
from atlas.platform.observability import RequestLogMiddleware, configure_json_logging
from atlas.platform.openapi import (
    OPENAPI_CONTACT,
    OPENAPI_DESCRIPTION,
    OPENAPI_LICENSE,
    OPENAPI_SERVERS,
    OPENAPI_SUMMARY,
    OPENAPI_TAGS,
    OPENAPI_TITLE,
    OPENAPI_VERSION,
    install_openapi_enrichment,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Sequence

    from mcp.server.fastmcp import FastMCP
    from mcp.server.transport_security import TransportSecuritySettings
    from starlette.applications import Starlette
    from starlette.routing import BaseRoute
    from starlette.types import ASGIApp, Lifespan, Receive, Scope, Send

logger = logging.getLogger(__name__)


def get_mcp() -> FastMCP:
    """Resolve the default server only when the ordinary lifespan needs it."""
    from atlas.platform.mcp.server import get_mcp as get_server

    return get_server()


def get_mcp_asgi_app(
    transport_security: TransportSecuritySettings | None = None,
    *,
    server: FastMCP | None = None,
) -> Starlette:
    """Keep the default transport lazy while preserving its existing call surface."""
    from atlas.platform.mcp.server import get_mcp_asgi_app as get_transport

    return get_transport(transport_security, server=server)


class McpMountPathAliasMiddleware:
    """Route exact `/mcp` requests into the mounted MCP app without redirecting."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == "/mcp":
            scope = dict(scope)
            scope["path"] = "/mcp/"
            if scope.get("raw_path") == b"/mcp":
                scope["raw_path"] = b"/mcp/"

        await self.app(scope, receive, send)


# Cloud Run lifts ``severity`` and ``message`` out of structured stdout. This
# runs at import so that logging during module load is structured too.
configure_json_logging(logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Lifespan context manager for startup and shutdown.

    Initializes the database on startup and starts the job worker.
    """
    from atlas.domains.discovery.worker import start_job_worker, stop_job_worker
    from atlas.domains.firehose.delivery_worker import start_delivery_worker, stop_delivery_worker

    # Startup
    settings = get_settings()
    validate_runtime_auth_config(settings)
    try:
        await init_db(settings.database_url, backend=settings.database_backend)
        logger.info("Database initialized successfully")
    except Exception:
        logger.exception("Failed to initialize database")
        raise

    job_worker_started = False
    firehose_worker_started = False
    if settings.discovery_job_worker_enabled:
        await start_job_worker(
            settings.database_url,
            database_backend=settings.database_backend,
            anthropic_api_key=settings.anthropic_api_key,
            search_api_key=settings.search_api_key,
            settings=settings,
        )
        job_worker_started = True
    if settings.firehose_delivery_worker_enabled:
        await start_delivery_worker(
            settings.database_url,
            database_backend=settings.database_backend,
            poll_seconds=settings.firehose_delivery_worker_poll_seconds,
            lease_seconds=settings.firehose_delivery_worker_lease_seconds,
            batch_size=settings.firehose_delivery_worker_batch_size,
        )
        firehose_worker_started = True

    # The FastMCP session manager owns the Streamable HTTP request lifecycle
    # and must be running before any /mcp request lands.
    async with get_mcp().session_manager.run():
        yield

    # Shutdown
    if firehose_worker_started:
        await stop_delivery_worker()
    if job_worker_started:
        await stop_job_worker()
    logger.info("Application shutting down")


def create_app(
    *,
    lifespan_override: Lifespan[FastAPI] | None = None,
    mcp_asgi_app: ASGIApp | None = None,
    prepared_http_routes: Sequence[BaseRoute] | None = None,
) -> FastAPI:
    """
    Create and configure the FastAPI application.

    Parameters
    ----------
    lifespan_override
        Explicit hosting lifecycle. Request-owned runtimes can keep migrations
        and background workers out of browsing and sign-in requests.
    mcp_asgi_app
        Request-owned MCP transport, mounted inside the same auth-adjacent
        rate limiting, CORS and logging middleware as the ordinary server.
        Its caller owns the MCP session manager through response completion.
    prepared_http_routes
        Hosting-owned static routes with request-bound dependency providers.
        Preparing these during deployment keeps cold profile visits from
        rebuilding validation models. Ordinary servers build their own routes.

    Returns
    -------
    FastAPI
        The configured application.
    """
    settings = get_settings()
    validate_runtime_auth_config(settings)

    # RFC 9700 §4.16: never reflect "*" origins while sending credentials in
    # production.  Catching the misconfiguration at app construction is far
    # safer than discovering it through a successful cross-origin token theft.
    if settings.environment == "production" and "*" in settings.cors_origins:
        msg = (
            "CORS_ORIGINS must not contain '*' when ENVIRONMENT is 'production'. "
            "List the trusted origins explicitly."
        )
        raise RuntimeError(msg)

    app = FastAPI(
        title=OPENAPI_TITLE,
        summary=OPENAPI_SUMMARY,
        description=OPENAPI_DESCRIPTION,
        version=OPENAPI_VERSION,
        contact=OPENAPI_CONTACT,
        license_info=OPENAPI_LICENSE,
        openapi_tags=OPENAPI_TAGS,
        servers=OPENAPI_SERVERS,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan if lifespan_override is None else lifespan_override,
    )
    install_openapi_enrichment(app)

    app.add_middleware(AnonymousRateLimitMiddleware, settings=settings)

    # CORS middleware — narrow methods so that the OAuth token endpoint and
    # other credentialed routes only see the verbs Atlas actually serves.
    #
    # Origins are widened beyond the literal `settings.cors_origins` list to
    # also include the configured auth issuer/audience origins, because
    # Starlette answers a mounted sub-app's preflight requests with the
    # *outer* app's own CORS middleware, never delegating to the sub-app's
    # middleware for `OPTIONS`. Without this, `get_mcp_asgi_app()`'s own CORS
    # middleware would never see a preflight request for `/mcp` at all. See
    # `split_cors_origins`'s docstring for the full explanation.
    #
    # The wildcard local-dev regex `split_cors_origins` can derive from
    # `LOCAL_ALLOWED_ORIGINS` is deliberately dropped outside of local/dev use:
    # those patterns exist for FastMCP's own DNS-rebinding *host guard*, where
    # trusting an arbitrary loopback port is harmless — it's just a transport
    # allowlist, not a credentialed CORS policy. This middleware *is* a
    # credentialed (`allow_credentials=True`), app-wide CORS policy, so
    # reusing that regex verbatim in production would let any page served
    # from a loopback origin make credentialed cross-origin requests against
    # the real API. In production, this middleware stays scoped to exact
    # origins only: `cors_origins` plus the configured auth issuer/audience
    # origins.
    # Catalog reads reuse the transport's origin policy without importing its
    # server SDK. Hosted MCP remains mounted and initializes on its own request.
    _, allowed_origins = build_transport_allowlists(settings)
    exact_origins, origin_regex = split_cors_origins(allowed_origins)
    if settings.environment == "production":
        origin_regex = None
    app.add_middleware(
        CORSMiddleware,
        allow_origins=exact_origins,
        allow_origin_regex=origin_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )
    app.add_middleware(McpMountPathAliasMiddleware)
    # Added last, so it is outermost: every request gets an id and a log line,
    # including one the rate limiter rejects.
    app.add_middleware(RequestLogMiddleware)

    # Health check endpoint
    @app.get(
        "/health",
        tags=["health"],
        operation_id="getHealth",
        summary="Health",
        description="Return the Atlas API health status.",
    )
    async def health_check(response: Response) -> dict[str, str]:
        """Return the Atlas API health status."""
        apply_no_store_headers(response)
        return {"status": "ok"}

    # RFC 9728 OAuth 2.0 Protected Resource Metadata.
    # MCP and OAuth 2.1 clients fetch this document to discover the
    # authorization server, supported scopes, and JWT signing parameters
    # before they ask a user to authorize a token.  The URL is the one
    # advertised in the WWW-Authenticate challenge, so it has to live under
    # the same canonical resource origin that gets recorded in audience
    # claims.
    #
    # The MCP discovery flow normally lands on the app-served document at the
    # canonical `/.well-known/oauth-protected-resource/mcp` (see
    # `app/src/routes/[.]well-known/oauth-protected-resource/mcp.ts`); this
    # copy exists so clients that interact with the API origin directly (e.g.
    # via the OpenAPI spec) can still resolve the authorization server.  The
    # payload mirrors the app document so both surfaces stay consistent.
    @app.get("/api/.well-known/oauth-protected-resource", include_in_schema=False)
    async def oauth_protected_resource_metadata(response: Response) -> dict[str, Any]:
        """Return RFC 9728 protected-resource metadata for this API."""
        apply_static_public_cache(response)
        resource_url = settings.auth_jwt_resource_url
        issuer = settings.auth_jwt_issuer
        issuer_origin = issuer.removesuffix("/api/auth") if issuer.endswith("/api/auth") else issuer
        metadata: dict[str, Any] = {
            "resource": resource_url,
            "authorization_servers": [issuer] if issuer else [],
            "bearer_methods_supported": ["header"],
            "scopes_supported": ["discovery:read", "api.mcp"],
        }
        if issuer_origin:
            metadata["resource_documentation"] = f"{issuer_origin}/docs/mcp"
        if settings.auth_jwt_jwks_url:
            metadata["jwks_uri"] = settings.auth_jwt_jwks_url
        return metadata

    if settings.enable_openapi_spec:

        @app.get("/openapi.json", include_in_schema=False)
        async def openapi_schema(response: Response) -> dict[str, Any]:
            """Serve the OpenAPI document with static-public cache headers."""
            apply_static_public_cache(response)
            return app.openapi()

    # Include API router
    if prepared_http_routes is None:
        app.include_router(create_router(managed=settings.managed))
    else:
        app.router.routes.extend(prepared_http_routes)

    # Mount the MCP Streamable HTTP transport at /mcp. get_mcp_asgi_app()
    # already wires the bearer-token auth guard (which advertises the
    # resource-specific PRM URL on 401s so MCP clients can discover the OAuth
    # issuer automatically) and CORS support onto the returned app. Passing
    # the `transport_security` computed above avoids deriving the same
    # allowlist from `settings` a second time.
    app.mount(
        "/mcp",
        get_mcp_asgi_app(build_transport_security_settings(settings))
        if mcp_asgi_app is None
        else mcp_asgi_app,
    )

    return app


@cache
def _get_default_application() -> FastAPI:
    return create_app()


def __getattr__(name: str) -> FastAPI:
    """Construct the ordinary ASGI server only when its loader requests it.

    Importing the explicit factory must not also build a second routing tree and
    MCP server beside a hosted instance. Keeping one application protects profile
    browsing from the hosted runtime's memory limit; uvicorn's ``atlas.main:app``
    entrypoint retains a stable process-owned instance.
    """
    if name != "app":
        raise AttributeError(name)
    return _get_default_application()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "atlas.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "dev",
        log_level=settings.log_level,
    )
