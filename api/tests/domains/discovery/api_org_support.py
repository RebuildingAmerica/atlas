"""Shared helpers for org-scoped discovery run tests."""

from __future__ import annotations

import aiosqlite
import pytest_asyncio

from atlas.domains.access.principals import AuthenticatedActor
from atlas.models.database import DB_SCHEMA

ORG_ID = "org_test_1"
USER_ID = "user_test_1"
USER_EMAIL = "test@atlas.test"


@pytest_asyncio.fixture
async def db() -> aiosqlite.Connection:
    """Create an in-memory database with schema."""
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(DB_SCHEMA)
    await conn.commit()
    yield conn
    await conn.close()


def _make_actor(org_id: str = ORG_ID) -> AuthenticatedActor:
    """Create a test authenticated actor with org context."""
    return AuthenticatedActor(
        user_id=USER_ID,
        email=USER_EMAIL,
        auth_type="local",
        is_local=True,
        org_id=org_id,
    )
