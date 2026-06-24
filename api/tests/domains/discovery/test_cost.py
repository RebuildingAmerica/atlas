"""Tests for the discovery cost ledger, ceilings, and kill switch."""

from atlas.models.database import get_db_connection


async def test_cost_ledger_table_exists(db_url: str) -> None:
    """init_db must create the cost_ledger table with the expected columns."""
    conn = await get_db_connection(db_url)
    try:
        cursor = await conn.execute("PRAGMA table_info(cost_ledger)")
        rows = await cursor.fetchall()
    finally:
        await conn.close()

    columns = {row[1] for row in rows}
    assert columns >= {
        "id",
        "run_id",
        "kind",
        "provider",
        "units",
        "estimated_cost",
        "created_at",
    }
