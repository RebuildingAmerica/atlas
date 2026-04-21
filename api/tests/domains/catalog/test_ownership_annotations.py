"""Tests for annotation CRUD operations in ownership module."""

from __future__ import annotations

import aiosqlite
import pytest_asyncio

from atlas.domains.catalog.models.ownership import AnnotationModel, OwnershipCRUD
from atlas.models.database import DB_SCHEMA

ORG_ID = "org_test_1"
OTHER_ORG_ID = "org_test_2"
AUTHOR_ID = "user_test_1"


@pytest_asyncio.fixture
async def db() -> aiosqlite.Connection:
    """Create an in-memory database with schema."""
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(DB_SCHEMA)
    await conn.commit()
    yield conn
    await conn.close()


@pytest_asyncio.fixture
async def sample_entry_id(db: aiosqlite.Connection) -> str:
    """Create a sample entry for annotation tests."""
    from atlas.models import EntryCRUD

    return await EntryCRUD.create(
        db,
        entry_type="organization",
        name="Test Org For Annotations",
        description="Used to test annotation CRUD.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )


async def test_create_annotation(db: aiosqlite.Connection, sample_entry_id: str) -> None:
    """Creating an annotation should return a model with all fields populated."""
    result = await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="This entry looks promising for our campaign.",
        author_id=AUTHOR_ID,
    )

    assert isinstance(result, AnnotationModel)
    assert result.org_id == ORG_ID
    assert result.entry_id == sample_entry_id
    assert result.content == "This entry looks promising for our campaign."
    assert result.author_id == AUTHOR_ID
    assert result.created_at != ""
    assert result.updated_at != ""
    assert result.id != ""


async def test_list_annotations_for_org(db: aiosqlite.Connection, sample_entry_id: str) -> None:
    """Listing annotations should return all annotations for the given org."""
    await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="Note 1",
        author_id=AUTHOR_ID,
    )
    await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="Note 2",
        author_id=AUTHOR_ID,
    )
    await OwnershipCRUD.create_annotation(
        db,
        org_id=OTHER_ORG_ID,
        entry_id=sample_entry_id,
        content="Other org note",
        author_id="other_user",
    )

    results = await OwnershipCRUD.list_annotations(db, ORG_ID)

    expected_count = 2
    assert len(results) == expected_count
    assert all(r.org_id == ORG_ID for r in results)


async def test_list_annotations_filtered_by_entry(
    db: aiosqlite.Connection, sample_entry_id: str
) -> None:
    """Listing annotations with entry_id should filter to that entry."""
    from atlas.models import EntryCRUD

    other_entry_id = await EntryCRUD.create(
        db,
        entry_type="person",
        name="Another Entry",
        description="Different entry.",
        city="Wichita",
        state="KS",
        geo_specificity="local",
    )

    await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="Note on sample",
        author_id=AUTHOR_ID,
    )
    await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=other_entry_id,
        content="Note on other",
        author_id=AUTHOR_ID,
    )

    results = await OwnershipCRUD.list_annotations(db, ORG_ID, entry_id=sample_entry_id)

    assert len(results) == 1
    assert results[0].entry_id == sample_entry_id


async def test_list_annotations_without_entry_filter(
    db: aiosqlite.Connection, sample_entry_id: str
) -> None:
    """Listing without entry_id should return all annotations for the org."""
    from atlas.models import EntryCRUD

    other_entry_id = await EntryCRUD.create(
        db,
        entry_type="person",
        name="Another Entry",
        description="Different entry.",
        city="Wichita",
        state="KS",
        geo_specificity="local",
    )

    await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="Note A",
        author_id=AUTHOR_ID,
    )
    await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=other_entry_id,
        content="Note B",
        author_id=AUTHOR_ID,
    )

    results = await OwnershipCRUD.list_annotations(db, ORG_ID)

    expected_count = 2
    assert len(results) == expected_count


async def test_get_annotation(db: aiosqlite.Connection, sample_entry_id: str) -> None:
    """Getting an annotation by ID should return the correct record."""
    created = await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="Specific note",
        author_id=AUTHOR_ID,
    )

    result = await OwnershipCRUD.get_annotation(db, created.id)

    assert result is not None
    assert result.id == created.id
    assert result.content == "Specific note"
    assert result.org_id == ORG_ID


async def test_get_annotation_returns_none_for_missing(
    db: aiosqlite.Connection,
) -> None:
    """Getting a nonexistent annotation should return None."""
    result = await OwnershipCRUD.get_annotation(db, "nonexistent_id")
    assert result is None


async def test_update_annotation(db: aiosqlite.Connection, sample_entry_id: str) -> None:
    """Updating an annotation should change its content and updated_at."""
    created = await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="Original note",
        author_id=AUTHOR_ID,
    )

    updated = await OwnershipCRUD.update_annotation(db, created.id, "Revised note")

    assert updated is not None
    assert updated.content == "Revised note"
    assert updated.id == created.id
    assert updated.org_id == ORG_ID


async def test_update_annotation_returns_none_for_missing(
    db: aiosqlite.Connection,
) -> None:
    """Updating a nonexistent annotation should return None."""
    result = await OwnershipCRUD.update_annotation(db, "nonexistent_id", "new content")
    assert result is None


async def test_delete_annotation(db: aiosqlite.Connection, sample_entry_id: str) -> None:
    """Deleting an annotation should remove it and return True."""
    created = await OwnershipCRUD.create_annotation(
        db,
        org_id=ORG_ID,
        entry_id=sample_entry_id,
        content="To be deleted",
        author_id=AUTHOR_ID,
    )

    deleted = await OwnershipCRUD.delete_annotation(db, created.id)
    assert deleted is True

    result = await OwnershipCRUD.get_annotation(db, created.id)
    assert result is None


async def test_delete_annotation_returns_false_for_missing(
    db: aiosqlite.Connection,
) -> None:
    """Deleting a nonexistent annotation should return False."""
    deleted = await OwnershipCRUD.delete_annotation(db, "nonexistent_id")
    assert deleted is False


async def test_list_by_org_with_visibility_filter(
    db: aiosqlite.Connection,
) -> None:
    """list_by_org with visibility filter should only return matching records."""
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="res_pub",
        resource_type="entry",
        org_id=ORG_ID,
        visibility="public",
        created_by=AUTHOR_ID,
    )
    await OwnershipCRUD.create_ownership(
        db,
        resource_id="res_priv",
        resource_type="entry",
        org_id=ORG_ID,
        visibility="private",
        created_by=AUTHOR_ID,
    )

    public_results = await OwnershipCRUD.list_by_org(db, ORG_ID, "entry", visibility="public")
    private_results = await OwnershipCRUD.list_by_org(db, ORG_ID, "entry", visibility="private")

    assert len(public_results) == 1
    assert public_results[0].resource_id == "res_pub"
    assert len(private_results) == 1
    assert private_results[0].resource_id == "res_priv"
