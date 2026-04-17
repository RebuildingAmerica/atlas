"""CLI entrypoint for Atlas database initialization."""

import asyncio

from atlas.platform.config import get_settings
from atlas.platform.database import init_db


async def main() -> None:
    """Initialize the configured Atlas database."""
    settings = get_settings()
    await init_db(settings.database_url)


def run() -> None:
    """Synchronous CLI wrapper for database initialization."""
    asyncio.run(main())


if __name__ == "__main__":
    run()
