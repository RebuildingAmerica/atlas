"""Pre-publication review queue.

Extends the moderation domain from reactive entity/source flags into a
proactive queue of discovered records held back from the public directory.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from atlas.platform.database import db

__all__ = ["ReviewQueueCRUD", "ReviewQueueItemModel"]

STALE_SOURCE_REVIEW_DAYS = 365
STALE_SOURCE_REVIEW_KIND = "source_staleness"
STALE_SOURCE_REVIEW_REASON = "stale_public_source_review"


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
        created_at=_row_timestamp(row[9]),
        reviewed_at=_row_timestamp(row[10]) if row[10] is not None else None,
        reviewed_by=row[11],
    )


_SELECT_COLUMNS = (
    "id, org_id, entity_id, kind, status, hold_reason, score, dedup_suspect, "
    "dedup_note, created_at, reviewed_at, reviewed_by"
)


def _row_timestamp(value: datetime | str) -> str:
    """Normalize SQLite/Postgres timestamp column values to strings."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


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
                dedup_suspect,
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
    async def enqueue_stale_public_sources(
        conn: Any,
        *,
        org_id: str | None = None,
        stale_after_days: int = STALE_SOURCE_REVIEW_DAYS,
    ) -> list[str]:
        """Enqueue public records whose latest source receipt is stale."""
        rows = await ReviewQueueCRUD._public_entry_source_rows(conn, org_id=org_id)
        threshold = datetime.now(UTC).date() - timedelta(days=stale_after_days)
        review_item_ids: list[str] = []
        for row_org_id, entity_id, latest_source_date, source_count in rows:
            latest_date = _coerce_date(str(latest_source_date) if latest_source_date else None)
            if latest_date is None or latest_date > threshold:
                continue
            if await ReviewQueueCRUD._has_pending_staleness_item(
                conn, org_id=str(row_org_id), entity_id=str(entity_id)
            ):
                continue
            review_item_id = await ReviewQueueCRUD.enqueue(
                conn,
                org_id=str(row_org_id),
                entity_id=str(entity_id),
                kind=STALE_SOURCE_REVIEW_KIND,
                hold_reason=STALE_SOURCE_REVIEW_REASON,
                score=float(source_count),
                dedup_suspect=False,
                dedup_note=f"Latest source date: {latest_date.isoformat()}",
            )
            review_item_ids.append(review_item_id)
        return review_item_ids

    @staticmethod
    async def _public_entry_source_rows(
        conn: Any,
        *,
        org_id: str | None,
    ) -> list[tuple[str, str, str | None, int]]:
        """Return public entries with their latest source receipt date."""
        where_org = "AND ro.org_id = ?" if org_id is not None else ""
        params = (org_id,) if org_id is not None else ()
        cursor = await conn.execute(
            f"""
            SELECT
                ro.org_id,
                e.id,
                MAX(COALESCE(s.published_date, SUBSTR(s.ingested_at, 1, 10), SUBSTR(s.created_at, 1, 10))),
                COUNT(DISTINCT s.id)
            FROM resource_ownership ro
            JOIN entries e ON e.id = ro.resource_id
            JOIN entry_sources es ON es.entry_id = e.id
            JOIN sources s ON s.id = es.source_id
            WHERE ro.resource_type = 'entry'
              AND ro.visibility = 'public'
              AND e.active = TRUE
              {where_org}
            GROUP BY ro.org_id, e.id
            """,
            params,
        )
        rows = await cursor.fetchall()
        return [(str(row[0]), str(row[1]), row[2], int(row[3] or 0)) for row in rows]

    @staticmethod
    async def _has_pending_staleness_item(conn: Any, *, org_id: str, entity_id: str) -> bool:
        """Return whether a stale-source review item is already pending."""
        cursor = await conn.execute(
            """
            SELECT 1 FROM review_queue
            WHERE status = 'pending'
              AND org_id = ?
              AND entity_id = ?
              AND kind = ?
              AND hold_reason = ?
            LIMIT 1
            """,
            (org_id, entity_id, STALE_SOURCE_REVIEW_KIND, STALE_SOURCE_REVIEW_REASON),
        )
        return await cursor.fetchone() is not None

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
        from atlas.domains.firehose.producers import record_review_decision_observation

        await record_review_decision_observation(
            conn,
            review_item_id=item_id,
            status=status,
            reviewed_by=reviewed_by,
        )

    @staticmethod
    async def count_pending(conn: Any) -> int:
        """Count records still awaiting review."""
        cursor = await conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'pending'")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0


def _coerce_date(value: str | None) -> date | None:
    """Parse a stored ISO date or timestamp into a date."""
    if value is None:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None
