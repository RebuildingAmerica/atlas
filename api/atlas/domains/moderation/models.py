"""Anonymous public flag persistence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db

__all__ = ["FlagCRUD", "FlagModel"]


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


class FlagCRUD:
    """CRUD helpers for entity and source flags."""

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
            SELECT id, entity_id, reason, note, status, created_at
            FROM entity_flags
            WHERE entity_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (entity_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [
            FlagModel(
                id=row[0],
                target_type="entity",
                target_id=row[1],
                reason=row[2],
                note=row[3],
                status=row[4],
                created_at=row[5],
            )
            for row in rows
        ]

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
            SELECT id, source_id, reason, note, status, created_at
            FROM source_flags
            WHERE source_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (source_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [
            FlagModel(
                id=row[0],
                target_type="source",
                target_id=row[1],
                reason=row[2],
                note=row[3],
                status=row[4],
                created_at=row[5],
            )
            for row in rows
        ]

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
