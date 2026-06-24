"""Tests for the pre-publication review queue table and CRUD."""

import pytest

from atlas.models.database import get_db_connection


@pytest.mark.asyncio
async def test_review_queue_table_exists(db_url: str) -> None:
    """init_db must create the review_queue table with the expected columns."""
    conn = await get_db_connection(db_url)
    try:
        cursor = await conn.execute("PRAGMA table_info(review_queue)")
        rows = await cursor.fetchall()
    finally:
        await conn.close()

    columns = {row[1] for row in rows}
    assert columns >= {
        "id",
        "entity_id",
        "kind",
        "status",
        "hold_reason",
        "score",
        "dedup_suspect",
        "created_at",
        "reviewed_at",
        "reviewed_by",
    }
