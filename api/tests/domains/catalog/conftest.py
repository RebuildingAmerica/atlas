"""Shared catalog profile fixtures."""

from __future__ import annotations

import pytest_asyncio

from atlas.models import EntryCRUD


@pytest_asyncio.fixture
async def claimable_org(test_db: object) -> str:
    """Create an org with a clear email/website domain to support tier-1 claims."""
    return await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Mississippi Rising",
        description="Statewide organizing nonprofit.",
        city="Jackson",
        state="MS",
        geo_specificity="statewide",
        website="https://mississippirising.org",
        email="info@mississippirising.org",
    )


@pytest_asyncio.fixture
async def claimable_person(test_db: object) -> str:
    """Create a person without contact info — tier-2 claim path only."""
    return await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Marcus Lee",
        description="Tenant advocate in Tupelo.",
        city="Tupelo",
        state="MS",
        geo_specificity="local",
    )
