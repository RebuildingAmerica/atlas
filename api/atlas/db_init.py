"""Command-line schema creation, behind ``python -m atlas.db_init``.

``make db-init`` and ``make db-reset`` both call it.
:func:`atlas.models.database.init_db` is idempotent.
"""

from __future__ import annotations

import asyncio

from atlas.models.database import init_db
from atlas.platform.config import get_settings


async def _main() -> None:
    settings = get_settings()
    database_url = settings.get_database_url()
    await init_db(database_url, backend=settings.database_backend)
    print(f"Schema initialized against {database_url.split('://', 1)[0]}://")


def main() -> None:
    """Entry point for ``python -m atlas.db_init``."""
    asyncio.run(_main())


if __name__ == "__main__":
    main()
