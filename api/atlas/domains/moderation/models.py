"""Anonymous public flag persistence."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db
from atlas.platform.dates import row_timestamp_string

__all__ = [
    "CorrectionInboxItem",
    "FlagCRUD",
    "FlagModel",
    "FlagStatusModel",
    "ModerationInboxItem",
]


@dataclass
class FlagModel:
    """Stored flag resource."""

    id: str
    target_type: str
    target_id: str
    reason: str
    note: str | None
    status: str
    created_at: str
    reviewed_at: str | None = None
    reviewed_by: str | None = None


@dataclass
class FlagStatusModel:
    """The only facts about a report that its anonymous submitter may see."""

    id: str
    status: str
    created_at: str
    reviewed_at: str | None


@dataclass
class CorrectionInboxItem:
    """A private profile report with enough context for an editor to act."""

    id: str
    entity_id: str
    entity_name: str
    entity_slug: str | None
    entity_type: str
    reason: str
    note: str | None
    created_at: str


@dataclass
class ModerationInboxItem:
    """An open profile or source report with its target identity."""

    id: str
    target_type: str
    target_id: str
    target_name: str
    entity_slug: str | None
    entity_type: str | None
    source_url: str | None
    reason: str
    note: str | None
    created_at: str
    linked_profiles: list[dict[str, str]] = field(default_factory=list)


class FlagCRUD:
    """CRUD helpers for entity and source flags."""

    @staticmethod
    def _entity_flag_from_row(row: Any) -> FlagModel:
        """Convert an entity flag row to a model."""
        return FlagModel(
            id=str(row[0]),
            target_type="entity",
            target_id=str(row[1]),
            reason=str(row[2]),
            note=str(row[3]) if row[3] is not None else None,
            status=str(row[4]),
            created_at=str(row[5]),
            reviewed_at=row_timestamp_string(row[6]),
            reviewed_by=str(row[7]) if row[7] is not None else None,
        )

    @staticmethod
    def _source_flag_from_row(row: Any) -> FlagModel:
        """Convert a source flag row to a model."""
        return FlagModel(
            id=str(row[0]),
            target_type="source",
            target_id=str(row[1]),
            reason=str(row[2]),
            note=str(row[3]) if row[3] is not None else None,
            status=str(row[4]),
            created_at=str(row[5]),
            reviewed_at=row_timestamp_string(row[6]),
            reviewed_by=str(row[7]) if row[7] is not None else None,
        )

    @staticmethod
    async def create_entity_flag(
        conn: aiosqlite.Connection,
        *,
        entity_id: str,
        reason: str,
        note: str | None = None,
    ) -> FlagModel:
        flag_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO entity_flags (id, entity_id, reason, note, status, created_at)
            VALUES (?, ?, ?, ?, 'open', ?)
            """,
            (flag_id, entity_id, reason, note, created_at),
        )
        await conn.commit()
        return FlagModel(
            id=flag_id,
            target_type="entity",
            target_id=entity_id,
            reason=reason,
            note=note,
            status="open",
            created_at=created_at,
        )

    @staticmethod
    async def create_source_flag(
        conn: aiosqlite.Connection,
        *,
        source_id: str,
        reason: str,
        note: str | None = None,
    ) -> FlagModel:
        flag_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO source_flags (id, source_id, reason, note, status, created_at)
            VALUES (?, ?, ?, ?, 'open', ?)
            """,
            (flag_id, source_id, reason, note, created_at),
        )
        await conn.commit()
        return FlagModel(
            id=flag_id,
            target_type="source",
            target_id=source_id,
            reason=reason,
            note=note,
            status="open",
            created_at=created_at,
        )

    @staticmethod
    async def list_entity_flags(
        conn: aiosqlite.Connection,
        *,
        entity_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[FlagModel]:
        cursor = await conn.execute(
            """
            SELECT id, entity_id, reason, note, status, created_at, reviewed_at, reviewed_by
            FROM entity_flags
            WHERE entity_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (entity_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [FlagCRUD._entity_flag_from_row(row) for row in rows]

    @staticmethod
    async def list_open_corrections(
        conn: aiosqlite.Connection, *, limit: int = 25, offset: int = 0
    ) -> list[CorrectionInboxItem]:
        """List oldest open profile reports for the authorized editor inbox."""
        cursor = await conn.execute(
            """
            SELECT f.id, f.entity_id, e.name, e.slug, e.type, f.reason, f.note, f.created_at
            FROM entity_flags f
            JOIN entries e ON e.id = f.entity_id
            WHERE f.status = 'open'
            ORDER BY f.created_at ASC, f.id ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        return [CorrectionInboxItem(*row) for row in await cursor.fetchall()]

    @staticmethod
    async def count_open_corrections(conn: aiosqlite.Connection) -> int:
        """Count actionable profile reports without exposing their notes."""
        cursor = await conn.execute("SELECT COUNT(*) FROM entity_flags WHERE status = 'open'")
        row = await cursor.fetchone()
        assert row is not None, "COUNT(*) always returns one row"
        return int(row[0])

    @staticmethod
    async def list_open_moderation_reports(
        conn: aiosqlite.Connection, *, limit: int = 25, offset: int = 0
    ) -> list[ModerationInboxItem]:
        """List all open visitor reports, oldest first, across both target types."""
        cursor = await conn.execute(
            """
            SELECT id, target_type, target_id, target_name, entity_slug,
                   entity_type, source_url, reason, note, created_at
            FROM (
                SELECT f.id, 'entity' AS target_type, f.entity_id AS target_id,
                       e.name AS target_name, e.slug AS entity_slug,
                       e.type AS entity_type, NULL AS source_url,
                       f.reason, f.note, f.created_at
                FROM entity_flags f
                JOIN entries e ON e.id = f.entity_id
                WHERE f.status = 'open'
                UNION ALL
                SELECT f.id, 'source' AS target_type, f.source_id AS target_id,
                       COALESCE(s.title, s.url) AS target_name,
                       NULL AS entity_slug, NULL AS entity_type, s.url AS source_url,
                       f.reason, f.note, f.created_at
                FROM source_flags f
                JOIN sources s ON s.id = f.source_id
                WHERE f.status = 'open'
            ) reports
            ORDER BY created_at ASC, id ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        items = [ModerationInboxItem(*row) for row in await cursor.fetchall()]
        source_ids = sorted({item.target_id for item in items if item.target_type == "source"})
        if source_ids:
            placeholders = ", ".join("?" for _ in source_ids)
            profile_cursor = await conn.execute(
                f"""
                SELECT es.source_id, e.name, e.slug, e.type
                FROM entry_sources es
                JOIN entries e ON e.id = es.entry_id
                WHERE es.source_id IN ({placeholders}) AND e.active = 1
                ORDER BY e.name, e.id
                """,
                source_ids,
            )
            profiles_by_source: dict[str, list[dict[str, str]]] = {}
            for source_id, name, slug, entry_type in await profile_cursor.fetchall():
                profiles_by_source.setdefault(str(source_id), []).append(
                    {"name": str(name), "slug": str(slug or ""), "type": str(entry_type)}
                )
            for item in items:
                if item.target_type == "source":
                    item.linked_profiles = profiles_by_source.get(item.target_id, [])
        return items

    @staticmethod
    async def count_open_moderation_reports(conn: aiosqlite.Connection) -> int:
        """Count all open profile and source reports."""
        cursor = await conn.execute(
            """
            SELECT (SELECT COUNT(*) FROM entity_flags WHERE status = 'open')
                 + (SELECT COUNT(*) FROM source_flags WHERE status = 'open')
            """
        )
        row = await cursor.fetchone()
        assert row is not None, "COUNT(*) always returns one row"
        return int(row[0])

    @staticmethod
    async def get_entity_flag_status(
        conn: aiosqlite.Connection, flag_id: str
    ) -> FlagStatusModel | None:
        """Return what a reporter may learn about their own profile report.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        flag_id : str
            The report reference shown on the reporter's receipt.

        Returns
        -------
        FlagStatusModel | None
            Status and dates only; the note and reviewer are never read here.
        """
        cursor = await conn.execute(
            "SELECT id, status, created_at, reviewed_at FROM entity_flags WHERE id = ?",
            (flag_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return FlagStatusModel(
            id=str(row[0]),
            status=str(row[1]),
            created_at=str(row_timestamp_string(row[2])),
            reviewed_at=row_timestamp_string(row[3]),
        )

    @staticmethod
    async def get_entity_flag(conn: aiosqlite.Connection, flag_id: str) -> FlagModel | None:
        """Return one entity flag by id."""
        cursor = await conn.execute(
            """
            SELECT id, entity_id, reason, note, status, created_at, reviewed_at, reviewed_by
            FROM entity_flags
            WHERE id = ?
            """,
            (flag_id,),
        )
        row = await cursor.fetchone()
        return FlagCRUD._entity_flag_from_row(row) if row is not None else None

    @staticmethod
    async def update_entity_flag_status(
        conn: aiosqlite.Connection,
        flag_id: str,
        *,
        status: str,
        reviewed_by: str,
    ) -> FlagModel | None:
        """Record an editor's decision on one entity flag."""
        await conn.execute(
            "UPDATE entity_flags SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
            (status, reviewed_by, db.now_iso(), flag_id),
        )
        await conn.commit()
        return await FlagCRUD.get_entity_flag(conn, flag_id)

    @staticmethod
    async def count_entity_flags(
        conn: aiosqlite.Connection,
        *,
        entity_id: str,
    ) -> int:
        """Count flags for one entity."""
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM entity_flags WHERE entity_id = ?",
            (entity_id,),
        )
        row = await cursor.fetchone()
        return int(row[0] or 0) if row else 0

    @staticmethod
    async def list_source_flags(
        conn: aiosqlite.Connection,
        *,
        source_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[FlagModel]:
        cursor = await conn.execute(
            """
            SELECT id, source_id, reason, note, status, created_at, reviewed_at, reviewed_by
            FROM source_flags
            WHERE source_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (source_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [FlagCRUD._source_flag_from_row(row) for row in rows]

    @staticmethod
    async def get_source_flag(conn: aiosqlite.Connection, flag_id: str) -> FlagModel | None:
        """Return one source flag by id."""
        cursor = await conn.execute(
            """
            SELECT id, source_id, reason, note, status, created_at, reviewed_at, reviewed_by
            FROM source_flags
            WHERE id = ?
            """,
            (flag_id,),
        )
        row = await cursor.fetchone()
        return FlagCRUD._source_flag_from_row(row) if row is not None else None

    @staticmethod
    async def update_source_flag_status(
        conn: aiosqlite.Connection,
        flag_id: str,
        *,
        status: str,
        reviewed_by: str,
    ) -> FlagModel | None:
        """Record an editor's decision on one source flag."""
        await conn.execute(
            "UPDATE source_flags SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
            (status, reviewed_by, db.now_iso(), flag_id),
        )
        await conn.commit()
        return await FlagCRUD.get_source_flag(conn, flag_id)

    @staticmethod
    async def count_source_flags(
        conn: aiosqlite.Connection,
        *,
        source_id: str,
    ) -> int:
        """Count flags for one source."""
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM source_flags WHERE source_id = ?",
            (source_id,),
        )
        row = await cursor.fetchone()
        return int(row[0] or 0) if row else 0

    @staticmethod
    async def entity_flag_summaries(
        conn: aiosqlite.Connection,
        entity_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        if not entity_ids:
            return {}
        placeholders = ", ".join(["?"] * len(entity_ids))
        cursor = await conn.execute(
            f"""
            SELECT
                entity_id,
                COUNT(*) AS flag_count,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_flag_count,
                MAX(created_at) AS latest_flagged_at
            FROM entity_flags
            WHERE entity_id IN ({placeholders})
            GROUP BY entity_id
            """,
            entity_ids,
        )
        rows = await cursor.fetchall()
        return {
            row[0]: {
                "flag_count": int(row[1] or 0),
                "open_flag_count": int(row[2] or 0),
                "latest_flagged_at": row[3],
                "has_open_flags": int(row[2] or 0) > 0,
            }
            for row in rows
        }

    @staticmethod
    async def source_flag_summaries(
        conn: aiosqlite.Connection,
        source_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        if not source_ids:
            return {}
        placeholders = ", ".join(["?"] * len(source_ids))
        cursor = await conn.execute(
            f"""
            SELECT
                source_id,
                COUNT(*) AS flag_count,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_flag_count,
                MAX(created_at) AS latest_flagged_at
            FROM source_flags
            WHERE source_id IN ({placeholders})
            GROUP BY source_id
            """,
            source_ids,
        )
        rows = await cursor.fetchall()
        return {
            row[0]: {
                "flag_count": int(row[1] or 0),
                "open_flag_count": int(row[2] or 0),
                "latest_flagged_at": row[3],
                "has_open_flags": int(row[2] or 0) > 0,
            }
            for row in rows
        }
