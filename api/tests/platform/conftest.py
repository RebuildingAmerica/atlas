from __future__ import annotations

import os
import uuid
from typing import TYPE_CHECKING
from unittest.mock import patch
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
import pytest_asyncio
from psycopg import sql

from atlas.platform.mcp import server as server_module

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from atlas.config import Settings


@pytest_asyncio.fixture
async def postgres_database_url() -> AsyncIterator[str]:
    """Create an isolated PostgreSQL database when the explicit test URL is set."""
    base_url = os.getenv("ATLAS_TEST_POSTGRES_URL")
    if base_url is None:
        pytest.skip("ATLAS_TEST_POSTGRES_URL is not set")

    parsed_url = urlsplit(base_url)
    if parsed_url.scheme not in {"postgres", "postgresql"}:
        pytest.fail("ATLAS_TEST_POSTGRES_URL must be a PostgreSQL URL")
    database_name = f"atlas_test_{uuid.uuid4().hex}"
    database_url = urlunsplit(parsed_url._replace(path=f"/{database_name}"))
    admin_conn = await psycopg.AsyncConnection.connect(base_url, autocommit=True)
    database_created = False
    try:
        await admin_conn.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )
        database_created = True
        yield database_url
    finally:
        if database_created:
            await admin_conn.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )
        await admin_conn.close()


@pytest.fixture
def patched_settings(test_settings: Settings) -> Iterator[Settings]:
    """Patch `get_settings` inside the MCP server module to use the test DB."""
    with patch.object(server_module, "get_settings", return_value=test_settings):
        yield test_settings
