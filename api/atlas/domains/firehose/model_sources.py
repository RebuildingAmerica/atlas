"""Firehose source target persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .model_records import (
    FirehoseSourceTargetCreate,
    FirehoseSourceTargetModel,
    row_dict,
    source_target_from_row,
)

if TYPE_CHECKING:
    import aiosqlite


class FirehoseSourceTargetCRUD:
    """CRUD operations for Firehose source targets."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        target_input: FirehoseSourceTargetCreate,
    ) -> FirehoseSourceTargetModel:
        """Create or update one source target for a workspace URL."""
        existing = await FirehoseSourceTargetCRUD.get_by_scope(
            conn,
            org_id=target_input.org_id,
            coverage_target_id=target_input.coverage_target_id,
            url=target_input.url,
        )
        now = db.now_iso()
        if existing is not None:
            await conn.execute(
                """
                UPDATE firehose_source_targets
                SET label = ?, source_class = ?, places_json = ?, issues_json = ?,
                    priority = ?, cadence_seconds = ?, enabled = ?, safety_policy = ?,
                    public_route_enabled = ?, origin = ?, origin_note = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    target_input.label,
                    target_input.source_class,
                    db.encode_json(target_input.places),
                    db.encode_json(target_input.issues),
                    target_input.priority,
                    target_input.cadence_seconds,
                    bool(target_input.enabled),
                    target_input.safety_policy,
                    bool(target_input.public_route_enabled),
                    target_input.origin,
                    target_input.origin_note,
                    now,
                    existing.id,
                ),
            )
            await conn.commit()
            updated = await FirehoseSourceTargetCRUD.get_by_id(conn, existing.id)
            assert updated is not None, "source target exists after update"
            return updated

        target_id = db.generate_uuid()
        await conn.execute(
            """
            INSERT INTO firehose_source_targets (
                id, org_id, coverage_target_id, label, url, source_kind, source_class,
                places_json, issues_json, priority, cadence_seconds, enabled, safety_policy,
                public_route_enabled, origin, origin_note, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_id,
                target_input.org_id,
                target_input.coverage_target_id,
                target_input.label,
                target_input.url,
                target_input.source_kind,
                target_input.source_class,
                db.encode_json(target_input.places),
                db.encode_json(target_input.issues),
                target_input.priority,
                target_input.cadence_seconds,
                bool(target_input.enabled),
                target_input.safety_policy,
                bool(target_input.public_route_enabled),
                target_input.origin,
                target_input.origin_note,
                target_input.created_by,
                now,
                now,
            ),
        )
        await conn.commit()
        target = await FirehoseSourceTargetCRUD.get_by_id(conn, target_id)
        assert target is not None, "source target was just inserted"
        return target

    @staticmethod
    async def get_by_scope(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        coverage_target_id: str,
        url: str,
    ) -> FirehoseSourceTargetModel | None:
        """Return one target by org, coverage target, and URL."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_source_targets
            WHERE org_id = ? AND coverage_target_id = ? AND url = ?
            """,
            (org_id, coverage_target_id, url),
        )
        row = await cursor.fetchone()
        return source_target_from_row(row_dict(cursor, row)) if row is not None else None

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        target_id: str,
    ) -> FirehoseSourceTargetModel | None:
        """Return one source target by id."""
        cursor = await conn.execute(
            "SELECT * FROM firehose_source_targets WHERE id = ?", (target_id,)
        )
        row = await cursor.fetchone()
        return source_target_from_row(row_dict(cursor, row)) if row is not None else None

    @staticmethod
    async def list_by_org(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
    ) -> list[FirehoseSourceTargetModel]:
        """Return source targets owned by one org."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_source_targets
            WHERE org_id = ?
            ORDER BY updated_at DESC, label ASC
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        return [source_target_from_row(row_dict(cursor, row)) for row in rows]

    @staticmethod
    async def record_check_result(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        target_id: str,
        checked_at: str,
        content_hash: str | None,
        etag: str | None,
        http_status: int | None,
        last_modified: str | None,
        error: str | None = None,
    ) -> None:
        """Store the latest source check state."""
        success_at = checked_at if error is None else None
        await conn.execute(
            """
            UPDATE firehose_source_targets
            SET last_checked_at = ?,
                last_success_at = COALESCE(?, last_success_at),
                last_error = ?,
                last_http_status = ?,
                etag = ?,
                last_modified = ?,
                content_hash = COALESCE(?, content_hash),
                updated_at = ?
            WHERE id = ?
            """,
            (
                checked_at,
                success_at,
                error,
                http_status,
                etag,
                last_modified,
                content_hash,
                checked_at,
                target_id,
            ),
        )
        await conn.commit()
