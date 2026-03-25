"""
FastAPI application entry point for The Atlas backend.

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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from atlas.api import create_router
from atlas.config import get_settings
from atlas.models import init_db

logger = logging.getLogger(__name__)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    """
    Lifespan context manager for startup and shutdown.

    Initializes the database on startup.
    """
    # Startup
    settings = get_settings()
    try:
        await init_db(settings.database_url)
        logger.info("Database initialized successfully")
    except Exception:
        logger.exception("Failed to initialize database")
        raise

    yield

    # Shutdown
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

    app = FastAPI(
        title="The Atlas Backend",
        description="Discovery platform for people, organizations, and initiatives working on contemporary American issues",
        version="0.1.0",
        docs_url="/docs" if settings.enable_api_docs else None,
        redoc_url="/redoc" if settings.enable_api_docs else None,
        openapi_url="/openapi.json" if settings.enable_api_docs else None,
        lifespan=lifespan,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Health check endpoint
    @app.get("/health")
    async def health_check() -> dict[str, str]:
        """
        Health check endpoint.

        Returns
        -------
        dict[str, str]
            Simple status response.
        """
        return {"status": "ok"}

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
