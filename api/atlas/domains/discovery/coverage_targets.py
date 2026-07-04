"""Coverage target persistence and status derivation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

CoverageStatus = Literal["covered", "thin", "unknown", "stale", "blocked"]
CoverageReviewState = Literal["needs_research", "in_review", "ready_for_delivery"]

COVERED_RECORD_THRESHOLD = 3
COVERED_SOURCE_THRESHOLD = 3
COVERAGE_STALE_DAYS = 90
JSON_STRING_LIST_ERROR = "Expected a JSON string list."
JSON_OBJECT_LIST_ERROR = "Expected a JSON object list."
JSON_OBJECT_ITEM_ERROR = "Expected each item to be an object."
JSON_OBJECT_VALUES_ERROR = "Expected string keys and values."
STALE_STATUS_REASON = "Coverage has not been reviewed in the last 90 days."


@dataclass(slots=True)
class CoverageStatusSummary:
    """Derived coverage status and evidence counts."""

    status: CoverageStatus
    status_reason: str
    records_found: int
    sources_reviewed: int
    last_run_at: str | None


@dataclass(slots=True)
class CoverageTargetModel:
    """Workspace coverage target."""

    id: str
    org_id: str
    name: str
    geography: str
    issue_areas: list[str]
    actor_types: list[str]
    source_types: list[str]
    status: CoverageStatus
    status_reason: str
    review_state: CoverageReviewState
    gaps: list[dict[str, str]]
    next_actions: list[str]
    records_found: int
    sources_reviewed: int
    linked_discovery_run_ids: list[str]
    linked_entry_ids: list[str]
    last_run_at: str | None
    last_reviewed_at: str | None
    created_by: str
    created_at: str
    updated_at: str


@dataclass(slots=True)
class CoverageTargetUpdate:
    """Replacement values for an existing workspace coverage target."""

    name: str
    geography: str
    issue_areas: list[str]
    actor_types: list[str]
    source_types: list[str]
    gaps: list[dict[str, str]]
    next_actions: list[str]
    linked_discovery_run_ids: list[str]
    linked_entry_ids: list[str]
    last_reviewed_at: str | None
    review_state: CoverageReviewState


class StoredCoverageTargetDecodeError(ValueError):
    """Raised when persisted coverage target JSON is malformed."""


def _decode_json_string_list(value: str) -> list[str]:
    """Decode a stored JSON string list."""
    decoded = db.decode_json(value)
    if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
        raise StoredCoverageTargetDecodeError(JSON_STRING_LIST_ERROR)
    return decoded


def _decode_json_object_list(value: str) -> list[dict[str, str]]:
    """Decode a stored JSON object list with string values."""
    decoded = db.decode_json(value)
    if not isinstance(decoded, list):
        raise StoredCoverageTargetDecodeError(JSON_OBJECT_LIST_ERROR)
    out: list[dict[str, str]] = []
    for item in decoded:
        if not isinstance(item, dict):
            raise StoredCoverageTargetDecodeError(JSON_OBJECT_ITEM_ERROR)
        normalized: dict[str, str] = {}
        for key, raw_value in item.items():
            if not isinstance(key, str) or not isinstance(raw_value, str):
                raise StoredCoverageTargetDecodeError(JSON_OBJECT_VALUES_ERROR)
            normalized[key] = raw_value
        out.append(normalized)
    return out


async def _linked_ids(
    conn: aiosqlite.Connection,
    *,
    table: str,
    id_column: str,
    target_id: str,
) -> list[str]:
    """Return linked ids for a coverage target from a known link table."""
    cursor = await conn.execute(
        f"SELECT {id_column} FROM {table} WHERE target_id = ? ORDER BY created_at, {id_column}",
        (target_id,),
    )
    return [str(row[0]) for row in await cursor.fetchall()]


async def _source_count_for_entries(
    conn: aiosqlite.Connection,
    entry_ids: list[str],
) -> int:
    """Return source receipts linked to a set of entries."""
    source_count = 0
    for entry_id in entry_ids:
        _entry, sources = await EntryCRUD.get_with_sources(conn, entry_id)
        source_count += len(sources)
    return source_count


async def derive_coverage_status(
    conn: aiosqlite.Connection,
    *,
    linked_discovery_run_ids: list[str],
    linked_entry_ids: list[str],
    last_reviewed_at: str | None = None,
) -> CoverageStatusSummary:
    """Derive status from linked runs, records, and source evidence."""
    records_from_runs = 0
    sources_from_runs = 0
    last_run_at: str | None = None
    has_failed_run = False

    for run_id in linked_discovery_run_ids:
        run = await DiscoveryRunCRUD.get_by_id(conn, run_id)
        if run is None:
            continue
        records_from_runs = max(records_from_runs, run.entries_confirmed)
        sources_from_runs = max(sources_from_runs, run.sources_processed)
        run_time = run.completed_at or run.started_at
        if last_run_at is None or run_time > last_run_at:
            last_run_at = run_time
        if run.status == "failed":
            has_failed_run = True

    entry_source_count = await _source_count_for_entries(conn, linked_entry_ids)
    records_found = max(records_from_runs, len(linked_entry_ids))
    sources_reviewed = max(sources_from_runs, entry_source_count)

    if has_failed_run:
        return CoverageStatusSummary(
            status="blocked",
            status_reason="Latest linked discovery run failed.",
            records_found=records_found,
            sources_reviewed=sources_reviewed,
            last_run_at=last_run_at,
        )

    if records_found == 0 and sources_reviewed == 0:
        return CoverageStatusSummary(
            status="unknown",
            status_reason="No linked discovery runs or records yet.",
            records_found=records_found,
            sources_reviewed=sources_reviewed,
            last_run_at=last_run_at,
        )

    latest_reference = _latest_recency_reference(last_run_at, last_reviewed_at)
    if latest_reference is not None and _is_stale(latest_reference):
        return CoverageStatusSummary(
            status="stale",
            status_reason=STALE_STATUS_REASON,
            records_found=records_found,
            sources_reviewed=sources_reviewed,
            last_run_at=last_run_at,
        )

    if records_found < COVERED_RECORD_THRESHOLD or sources_reviewed < COVERED_SOURCE_THRESHOLD:
        return CoverageStatusSummary(
            status="thin",
            status_reason="Coverage has fewer than 3 records or sources.",
            records_found=records_found,
            sources_reviewed=sources_reviewed,
            last_run_at=last_run_at,
        )

    return CoverageStatusSummary(
        status="covered",
        status_reason="Coverage has current records and sources.",
        records_found=records_found,
        sources_reviewed=sources_reviewed,
        last_run_at=last_run_at,
    )


def _parse_datetime(value: str | None) -> datetime | None:
    """Parse an ISO timestamp into an aware UTC datetime."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _latest_recency_reference(
    last_run_at: str | None,
    last_reviewed_at: str | None,
) -> datetime | None:
    """Return the most recent run or review timestamp."""
    references = [
        parsed
        for parsed in (_parse_datetime(last_run_at), _parse_datetime(last_reviewed_at))
        if parsed is not None
    ]
    if not references:
        return None
    return max(references)


def _is_stale(reference: datetime) -> bool:
    """Return whether a coverage reference is older than the operational threshold."""
    return datetime.now(UTC) - reference > timedelta(days=COVERAGE_STALE_DAYS)


async def _row_to_target(
    conn: aiosqlite.Connection,
    row: dict[str, Any],
) -> CoverageTargetModel:
    """Convert a database row into a coverage target model."""
    target_id = str(row["id"])
    linked_run_ids = await _linked_ids(
        conn,
        table="org_coverage_target_runs",
        id_column="run_id",
        target_id=target_id,
    )
    linked_entry_ids = await _linked_ids(
        conn,
        table="org_coverage_target_entries",
        id_column="entry_id",
        target_id=target_id,
    )
    return CoverageTargetModel(
        id=target_id,
        org_id=str(row["org_id"]),
        name=str(row["name"]),
        geography=str(row["geography"]),
        issue_areas=_decode_json_string_list(str(row["issue_areas_json"])),
        actor_types=_decode_json_string_list(str(row["actor_types_json"])),
        source_types=_decode_json_string_list(str(row["source_types_json"])),
        status=row["status"],
        status_reason=str(row["status_reason"]),
        review_state=row["review_state"],
        gaps=_decode_json_object_list(str(row["gaps_json"])),
        next_actions=_decode_json_string_list(str(row["next_actions_json"])),
        records_found=int(row["records_found"]),
        sources_reviewed=int(row["sources_reviewed"]),
        linked_discovery_run_ids=linked_run_ids,
        linked_entry_ids=linked_entry_ids,
        last_run_at=row["last_run_at"],
        last_reviewed_at=row["last_reviewed_at"],
        created_by=str(row["created_by"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


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
