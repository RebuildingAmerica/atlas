"""Pre-publication review queue.

Extends the moderation domain from reactive entity/source flags into a
proactive queue of discovered records held back from the public directory.
"""

from dataclasses import dataclass
from typing import Any

from atlas.platform.database import db

__all__ = ["ReviewQueueCRUD", "ReviewQueueItemModel"]


@dataclass
class ReviewQueueItemModel:
    """A discovered record held for human review before publication."""

    id: str
    org_id: str | None
    entity_id: str | None
    kind: str
    status: str
    hold_reason: str
    score: float | None
    dedup_suspect: bool
    dedup_note: str | None
    created_at: str
    reviewed_at: str | None
    reviewed_by: str | None


def _row_to_item(row: tuple[Any, ...]) -> ReviewQueueItemModel:
    return ReviewQueueItemModel(
        id=row[0],
        org_id=row[1],
        entity_id=row[2],
        kind=row[3],
        status=row[4],
        hold_reason=row[5],
        score=row[6],
        dedup_suspect=bool(row[7]),
        dedup_note=row[8],
        created_at=row[9],
        reviewed_at=row[10],
        reviewed_by=row[11],
    )


_SELECT_COLUMNS = (
    "id, org_id, entity_id, kind, status, hold_reason, score, dedup_suspect, "
    "dedup_note, created_at, reviewed_at, reviewed_by"
)


class ReviewQueueCRUD:
    """CRUD for the pre-publication review queue."""

    @staticmethod
    async def enqueue(  # noqa: PLR0913
        conn: Any,
        *,
        org_id: str | None = None,
        entity_id: str | None,
        kind: str,
        hold_reason: str,
        score: float | None,
        dedup_suspect: bool,
        dedup_note: str | None,
    ) -> str:
        """Insert a held record and return its id."""
        item_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO review_queue (
                id, org_id, entity_id, kind, status, hold_reason, score,
                dedup_suspect, dedup_note, created_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                org_id,
                entity_id,
                kind,
                hold_reason,
                score,
                1 if dedup_suspect else 0,
                dedup_note,
                created_at,
            ),
        )
        await conn.commit()
        return item_id

    @staticmethod
    async def list_pending(
        conn: Any, *, limit: int = 50, offset: int = 0, org_id: str | None = None
    ) -> list[ReviewQueueItemModel]:
        """List pending held records oldest-first."""
        if org_id is not None:
            cursor = await conn.execute(
                f"""
                SELECT {_SELECT_COLUMNS} FROM review_queue
                WHERE status = 'pending' AND org_id = ?
                ORDER BY created_at ASC
                LIMIT ? OFFSET ?
                """,
                (org_id, limit, offset),
            )
            rows = await cursor.fetchall()
            return [_row_to_item(row) for row in rows]

        cursor = await conn.execute(
            f"""
            SELECT {_SELECT_COLUMNS} FROM review_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [_row_to_item(row) for row in rows]

    @staticmethod
    async def get_by_id(conn: Any, item_id: str) -> ReviewQueueItemModel | None:
        """Fetch one held record by id."""
        cursor = await conn.execute(
            f"SELECT {_SELECT_COLUMNS} FROM review_queue WHERE id = ?",
            (item_id,),
        )
        row = await cursor.fetchone()
        return _row_to_item(row) if row else None

    @staticmethod
    async def approve(conn: Any, item_id: str, *, reviewed_by: str) -> None:
        """Approve a held record: publish its entry and close the item."""
        item = await ReviewQueueCRUD.get_by_id(conn, item_id)
        if item is None or item.entity_id is None:
            await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)
            return
        await conn.execute("UPDATE entries SET active = TRUE WHERE id = ?", (item.entity_id,))
        await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)

    @staticmethod
    async def reject(conn: Any, item_id: str, *, reviewed_by: str) -> None:
        """Reject a held record: leave its entry inactive, close the item."""
        await ReviewQueueCRUD._close(conn, item_id, "rejected", reviewed_by)

    @staticmethod
    async def _close(conn: Any, item_id: str, status: str, reviewed_by: str) -> None:
        await conn.execute(
            "UPDATE review_queue SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            (status, db.now_iso(), reviewed_by, item_id),
        )
        await conn.commit()

    @staticmethod
    async def count_pending(conn: Any) -> int:
        """Count records still awaiting review."""
        cursor = await conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'pending'")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0
