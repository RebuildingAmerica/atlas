"""Shared fixtures and constants for schedule API tests."""

from __future__ import annotations

import tempfile

import pytest
import pytest_asyncio

from atlas.domains.access.principals import AuthenticatedActor
from atlas.models import get_db_connection, init_db

EXPECTED_NOT_FOUND = 404
EXPECTED_BAD_REQUEST = 400
EXPECTED_ACCEPTED = 202
EXPECTED_TWO = 2
INLINE_FORBIDDEN = "pipeline must not run inline for scheduled triggers"


@pytest_asyncio.fixture
async def test_db() -> object:
    """Create a temporary test database with schema."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        url = f"sqlite:///{f.name}"
    await init_db(url)
    conn = await get_db_connection(url)
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
def actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="test-user",
        email="test@example.com",
        auth_type="local",
        permissions={"discovery": ["read", "write"]},
    )
