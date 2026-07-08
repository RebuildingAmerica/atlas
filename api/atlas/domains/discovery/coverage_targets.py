"""Coverage target persistence and status derivation."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.database import db

from .coverage_targets_support import (
    COVERAGE_STALE_DAYS,
    CoverageReviewState,
    CoverageStatus,
    CoverageStatusSummary,
    CoverageTargetModel,
    CoverageTargetUpdate,
    StoredCoverageTargetDecodeError,
    _decode_json_object_list,
    _decode_json_string_list,
    _is_stale,
    _latest_recency_reference,
    _parse_datetime,
    _row_to_target,
    _source_count_for_entries,
    derive_coverage_status,
)

if TYPE_CHECKING:
    import aiosqlite

__all__ = [
    "COVERAGE_STALE_DAYS",
    "CoverageReviewState",
    "CoverageStatus",
    "CoverageStatusSummary",
    "CoverageTargetCRUD",
    "CoverageTargetModel",
    "CoverageTargetUpdate",
    "DiscoveryRunCRUD",
    "EntryCRUD",
    "StoredCoverageTargetDecodeError",
    "_decode_json_object_list",
    "_decode_json_string_list",
    "_is_stale",
    "_latest_recency_reference",
    "_parse_datetime",
    "_source_count_for_entries",
    "derive_coverage_status",
]


class CoverageTargetCRUD:
    """CRUD operations for org coverage targets."""

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        name: str,
        geography: str,
        issue_areas: list[str],
        actor_types: list[str],
        source_types: list[str],
        gaps: list[dict[str, str]],
        next_actions: list[str],
        linked_discovery_run_ids: list[str],
        linked_entry_ids: list[str],
        created_by: str,
        last_reviewed_at: str | None = None,
        review_state: CoverageReviewState = "needs_research",
    ) -> CoverageTargetModel:
        """Create a coverage target and derive its initial status."""
        target_id = db.generate_uuid()
        now = db.now_iso()
        summary = await derive_coverage_status(
            conn,
            linked_discovery_run_ids=linked_discovery_run_ids,
            linked_entry_ids=linked_entry_ids,
            last_reviewed_at=last_reviewed_at,
        )
        await conn.execute(
            """
            INSERT INTO org_coverage_targets (
                id, org_id, name, geography, issue_areas_json, actor_types_json,
                source_types_json, status, status_reason, gaps_json, next_actions_json,
                review_state, records_found, sources_reviewed, last_run_at, last_reviewed_at,
                created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_id,
                org_id,
                name,
                geography,
                db.encode_json(issue_areas),
                db.encode_json(actor_types),
                db.encode_json(source_types),
                summary.status,
                summary.status_reason,
                db.encode_json(gaps),
                db.encode_json(next_actions),
                review_state,
                summary.records_found,
                summary.sources_reviewed,
                summary.last_run_at,
                last_reviewed_at,
                created_by,
                now,
                now,
            ),
        )
        await CoverageTargetCRUD.replace_links(
            conn,
            target_id=target_id,
            linked_discovery_run_ids=linked_discovery_run_ids,
            linked_entry_ids=linked_entry_ids,
        )
        await conn.commit()
        target = await CoverageTargetCRUD.get(conn, target_id)
        assert target is not None, "coverage target was just inserted"
        return target

    @staticmethod
    async def replace_links(
        conn: aiosqlite.Connection,
        *,
        target_id: str,
        linked_discovery_run_ids: list[str],
        linked_entry_ids: list[str],
    ) -> None:
        """Replace run and entry links for a coverage target."""
        now = db.now_iso()
        await conn.execute("DELETE FROM org_coverage_target_runs WHERE target_id = ?", (target_id,))
        await conn.execute(
            "DELETE FROM org_coverage_target_entries WHERE target_id = ?",
            (target_id,),
        )
        for run_id in linked_discovery_run_ids:
            await conn.execute(
                """
                INSERT INTO org_coverage_target_runs (target_id, run_id, created_at)
                VALUES (?, ?, ?)
                """,
                (target_id, run_id, now),
            )
        for entry_id in linked_entry_ids:
            await conn.execute(
                """
                INSERT INTO org_coverage_target_entries (target_id, entry_id, created_at)
                VALUES (?, ?, ?)
                """,
                (target_id, entry_id, now),
            )

    @staticmethod
    async def get(
        conn: aiosqlite.Connection,
        target_id: str,
    ) -> CoverageTargetModel | None:
        """Return a coverage target by id."""
        cursor = await conn.execute(
            "SELECT * FROM org_coverage_targets WHERE id = ?",
            (target_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [col[0] for col in cursor.description]
        return await _row_to_target(conn, dict(zip(columns, row, strict=False)))

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        target_id: str,
        update_input: CoverageTargetUpdate,
    ) -> CoverageTargetModel | None:
        """Update a coverage target and re-derive its evidence status."""
        now = db.now_iso()
        summary = await derive_coverage_status(
            conn,
            linked_discovery_run_ids=update_input.linked_discovery_run_ids,
            linked_entry_ids=update_input.linked_entry_ids,
            last_reviewed_at=update_input.last_reviewed_at,
        )
        cursor = await conn.execute(
            """
            UPDATE org_coverage_targets
            SET name = ?,
                geography = ?,
                issue_areas_json = ?,
                actor_types_json = ?,
                source_types_json = ?,
                status = ?,
                status_reason = ?,
                review_state = ?,
                gaps_json = ?,
                next_actions_json = ?,
                records_found = ?,
                sources_reviewed = ?,
                last_run_at = ?,
                last_reviewed_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                update_input.name,
                update_input.geography,
                db.encode_json(update_input.issue_areas),
                db.encode_json(update_input.actor_types),
                db.encode_json(update_input.source_types),
                summary.status,
                summary.status_reason,
                update_input.review_state,
                db.encode_json(update_input.gaps),
                db.encode_json(update_input.next_actions),
                summary.records_found,
                summary.sources_reviewed,
                summary.last_run_at,
                update_input.last_reviewed_at,
                now,
                target_id,
            ),
        )
        if cursor.rowcount == 0:
            return None

        await CoverageTargetCRUD.replace_links(
            conn,
            target_id=target_id,
            linked_discovery_run_ids=update_input.linked_discovery_run_ids,
            linked_entry_ids=update_input.linked_entry_ids,
        )
        await conn.commit()
        return await CoverageTargetCRUD.get(conn, target_id)

    @staticmethod
    async def list_by_org(
        conn: aiosqlite.Connection,
        org_id: str,
    ) -> list[CoverageTargetModel]:
        """Return coverage targets owned by an org."""
        cursor = await conn.execute(
            """
            SELECT * FROM org_coverage_targets
            WHERE org_id = ?
            ORDER BY updated_at DESC, name ASC
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        columns = [col[0] for col in cursor.description]
        return [await _row_to_target(conn, dict(zip(columns, row, strict=False))) for row in rows]
