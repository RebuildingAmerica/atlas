"""CLI entrypoint for Atlas database initialization."""

import asyncio

from atlas.config import get_settings
from atlas.models.database import init_db


async def main() -> None:
    """Initialize the configured Atlas database."""
    settings = get_settings()
    await init_db(settings.database_url)


if __name__ == "__main__":
    asyncio.run(main())
