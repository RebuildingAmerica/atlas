"""
FastAPI application entry point for The Atlas API.

Configures:
- CORS middleware
- Lifespan (startup/shutdown)
- Database initialization
- API routes
- Health check endpoint
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from atlas.config import get_settings, validate_runtime_auth_config
from atlas.models import init_db
from atlas.platform.http import create_router
from atlas.platform.http.anonymous_rate_limit import AnonymousRateLimitMiddleware
from atlas.platform.http.cache import apply_no_store_headers, apply_static_public_cache
from atlas.platform.mcp import (
    build_transport_security_settings,
    get_mcp,
    get_mcp_asgi_app,
    split_cors_origins,
)
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

logger = logging.getLogger(__name__)


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


def configure_logging() -> None:
    """Configure logging for the application."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )


# Configure logging
configure_logging()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Lifespan context manager for startup and shutdown.

    Initializes the database on startup and starts the job worker.
    """
    from atlas.domains.discovery.worker import start_job_worker, stop_job_worker

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
    if settings.discovery_job_worker_enabled:
        await start_job_worker(
            settings.database_url,
            database_backend=settings.database_backend,
            anthropic_api_key=settings.anthropic_api_key,
            search_api_key=settings.search_api_key,
            settings=settings,
        )
        job_worker_started = True

    # The FastMCP session manager owns the Streamable HTTP request lifecycle
    # and must be running before any /mcp request lands.
    async with get_mcp().session_manager.run():
        yield

    # Shutdown
    if job_worker_started:
        await stop_job_worker()
    logger.info("Application shutting down")


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

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
        lifespan=lifespan,
    )
    install_openapi_enrichment(app)

    app.add_middleware(AnonymousRateLimitMiddleware, settings=settings)

    # CORS middleware — narrow methods so that the OAuth token endpoint and
    # other credentialed routes only see the verbs Atlas actually serves.
    #
    # Origins are widened beyond the literal `settings.cors_origins` list to
    # the full MCP transport-security allowlist (local-dev wildcard ports,
    # plus the configured auth issuer/audience origins) because Starlette
    # answers a mounted sub-app's preflight requests with the *outer* app's
    # own CORS middleware, never delegating to the sub-app's middleware for
    # `OPTIONS`. Without this, `get_mcp_asgi_app()`'s own CORS middleware
    # would never see a preflight request for `/mcp` at all, and a browser
    # MCP host on an arbitrary local port would get rejected here first. See
    # `split_cors_origins`'s docstring for the full explanation.
    exact_origins, origin_regex = split_cors_origins(
        build_transport_security_settings(settings).allowed_origins
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=exact_origins,
        allow_origin_regex=origin_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )
    app.add_middleware(McpMountPathAliasMiddleware)

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
    app.include_router(create_router())

    # Mount the MCP Streamable HTTP transport at /mcp. get_mcp_asgi_app()
    # already wires the bearer-token auth guard (which advertises the
    # resource-specific PRM URL on 401s so MCP clients can discover the OAuth
    # issuer automatically) and CORS support onto the returned app.
    app.mount("/mcp", get_mcp_asgi_app())

    return app


# Create the application instance
app = create_app()


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
