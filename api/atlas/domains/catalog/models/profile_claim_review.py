"""Read helpers for reviewer-facing profile verification queues."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.domains.catalog.models.profile_claims_support import ProfileClaimModel, _row_to_claim

if TYPE_CHECKING:
    import aiosqlite


async def list_pending_profile_claim_reviews(
    conn: aiosqlite.Connection,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[ProfileClaimModel]:
    """Return pending profile verifications oldest-first."""
    cursor = await conn.execute(
        """
        SELECT * FROM profile_claims
        WHERE status = 'pending' AND tier != 1
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )
    rows = await cursor.fetchall()
    columns = [desc[0] for desc in cursor.description]
    return [_row_to_claim(dict(zip(columns, row, strict=False))) for row in rows]


async def count_pending_profile_claim_reviews(conn: aiosqlite.Connection) -> int:
    """Return the number of pending profile verifications."""
    cursor = await conn.execute(
        "SELECT COUNT(*) FROM profile_claims WHERE status = 'pending' AND tier != 1"
    )
    row = await cursor.fetchone()
    return int(row[0]) if row is not None else 0
