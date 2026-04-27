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
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html

from atlas.config import get_settings
from atlas.models import init_db
from atlas.platform.http import create_router
from atlas.platform.http.cache import apply_no_store_headers, apply_static_public_cache
from atlas.platform.openapi import (
    OPENAPI_CONTACT,
    OPENAPI_DESCRIPTION,
    OPENAPI_LICENSE,
    OPENAPI_SERVERS,
    OPENAPI_SUMMARY,
    OPENAPI_TAGS,
    OPENAPI_TITLE,
    OPENAPI_VERSION,
)

logger = logging.getLogger(__name__)


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
    try:
        await init_db(settings.database_url, backend=settings.database_backend)
        logger.info("Database initialized successfully")
    except Exception:
        logger.exception("Failed to initialize database")
        raise

    await start_job_worker(
        settings.database_url,
        database_backend=settings.database_backend,
        anthropic_api_key=settings.anthropic_api_key,
        search_api_key=settings.search_api_key,
    )

    yield

    # Shutdown
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

    # CORS middleware — narrow methods so that the OAuth token endpoint and
    # other credentialed routes only see the verbs Atlas actually serves.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    # Health check endpoint
    @app.get("/health")
    async def health_check(response: Response) -> dict[str, str]:
        """
        Health check endpoint.

        Returns
        -------
        dict[str, str]
            Simple status response.
        """
        apply_no_store_headers(response)
        return {"status": "ok"}

    if settings.enable_openapi_spec:

        @app.get("/openapi.json", include_in_schema=False)
        async def openapi_schema(response: Response) -> dict[str, Any]:
            """Serve the OpenAPI document with static-public cache headers."""
            apply_static_public_cache(response)
            return app.openapi()

    if settings.enable_api_docs_ui:

        @app.get("/docs", include_in_schema=False)
        async def swagger_ui() -> Response:
            """Serve Swagger UI for the current OpenAPI document."""
            swagger_response = get_swagger_ui_html(
                openapi_url="/openapi.json",
                title=f"{app.title} - Swagger UI",
            )
            apply_static_public_cache(swagger_response)
            return swagger_response

        @app.get("/redoc", include_in_schema=False)
        async def redoc_ui() -> Response:
            """Serve ReDoc for the current OpenAPI document."""
            redoc_response = get_redoc_html(
                openapi_url="/openapi.json",
                title=f"{app.title} - ReDoc",
            )
            apply_static_public_cache(redoc_response)
            return redoc_response

    # Include API router
    app.include_router(create_router())

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
