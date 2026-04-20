"""Tests for ownership CRUD operations."""

from __future__ import annotations

import aiosqlite
import pytest_asyncio

from atlas.domains.catalog.models.ownership import OwnershipCRUD, OwnershipModel
from atlas.models.database import DB_SCHEMA


@pytest_asyncio.fixture
async def db() -> aiosqlite.Connection:
    """Create an in-memory database with schema."""
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(DB_SCHEMA)
    await conn.commit()
    yield conn
    await conn.close()


async def test_create_ownership_creates_row(db: aiosqlite.Connection) -> None:
    """Creating an entry ownership record should return a model with correct fields."""
    result = await OwnershipCRUD.create_ownership(
        db,
        resource_id="entry_1",
        resource_type="entry",
        org_id="org_1",
        visibility="public",
        created_by="user_1",
    )

    assert isinstance(result, OwnershipModel)
    assert result.resource_id == "entry_1"
    assert result.resource_type == "entry"
    assert result.org_id == "org_1"
    assert result.visibility == "public"
    assert result.created_by == "user_1"
    assert result.created_at != ""


async def test_get_ownership_returns_correct_record(db: aiosqlite.Connection) -> None:
    """get_ownership should return the record matching resource_id and resource_type."""
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="entry_2",
        resource_type="entry",
        org_id="org_2",
        visibility="private",
        created_by="user_2",
    )

    result = await OwnershipCRUD.get_ownership(db, "entry_2", "entry")

    assert result is not None
    assert result.resource_id == "entry_2"
    assert result.org_id == "org_2"
    assert result.visibility == "private"
    assert result.created_by == "user_2"


async def test_get_ownership_returns_none_for_missing(db: aiosqlite.Connection) -> None:
    """get_ownership should return None when no record exists."""
    result = await OwnershipCRUD.get_ownership(db, "nonexistent", "entry")
    assert result is None


async def test_list_by_org_returns_only_matching_org(db: aiosqlite.Connection) -> None:
    """list_by_org should only return records for the specified org."""
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="entry_a",
        resource_type="entry",
        org_id="org_alpha",
        created_by="user_1",
    )
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="entry_b",
        resource_type="entry",
        org_id="org_alpha",
        created_by="user_1",
    )
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="entry_c",
        resource_type="entry",
        org_id="org_beta",
        created_by="user_2",
    )

    alpha_records = await OwnershipCRUD.list_by_org(db, "org_alpha", "entry")
    beta_records = await OwnershipCRUD.list_by_org(db, "org_beta", "entry")

    expected_alpha_count = 2
    assert len(alpha_records) == expected_alpha_count
    assert all(r.org_id == "org_alpha" for r in alpha_records)
    expected_beta_count = 1
    assert len(beta_records) == expected_beta_count
    assert beta_records[0].org_id == "org_beta"
    assert beta_records[0].resource_id == "entry_c"


async def test_delete_ownership_removes_record(db: aiosqlite.Connection) -> None:
    """delete_ownership should remove the record and return True."""
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="entry_del",
        resource_type="entry",
        org_id="org_1",
        created_by="user_1",
    )

    deleted = await OwnershipCRUD.delete_ownership(db, "entry_del", "entry")
    assert deleted is True

    # Verify the record is gone
    result = await OwnershipCRUD.get_ownership(db, "entry_del", "entry")
    assert result is None


async def test_delete_ownership_returns_false_for_missing(db: aiosqlite.Connection) -> None:
    """delete_ownership should return False when the record does not exist."""
    deleted = await OwnershipCRUD.delete_ownership(db, "nonexistent", "entry")
    assert deleted is False
