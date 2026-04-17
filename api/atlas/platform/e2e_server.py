"""Dedicated API entrypoint for browser-level end-to-end tests."""

import asyncio

import uvicorn

from atlas.platform.config import get_settings
from atlas.platform.database import init_db


async def bootstrap_database() -> None:
    """Initialize the configured database before serving requests."""
    settings = get_settings()
    await init_db(settings.database_url)


def run() -> None:
    """Start the Atlas API with explicit e2e-friendly startup behavior."""
    settings = get_settings()
    asyncio.run(bootstrap_database())
    uvicorn.run(
        "atlas.main:app",
        host="127.0.0.1",
        port=settings.port,
        reload=False,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    run()
