"""Workspace watch change events and digest queries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

WatchResourceType = Literal["entry", "coverage_target"]
WatchEventType = Literal[
    "new_source",
    "profile_updated",
    "relationship_added",
    "coverage_status_changed",
    "correction",
    "civic_signal",
]

__all__ = [
    "OrgChangeEventCRUD",
    "OrgChangeEventModel",
    "OrgChangeEventRecord",
    "OrgChangeEventSourceKey",
    "WatchEventType",
]


@dataclass(slots=True)
class OrgChangeEventModel:
    """A source-backed change for one watched workspace resource."""

    id: str
    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    event_type: WatchEventType
    title: str
    summary: str
    source_id: str | None
    entry_id: str | None
    coverage_target_id: str | None
    metadata_json: str
    created_at: str


@dataclass(slots=True)
class OrgChangeEventRecord:
    """Input for recording one watch change event."""

    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    event_type: WatchEventType
    title: str
    summary: str
    source_id: str | None = None
    entry_id: str | None = None
    coverage_target_id: str | None = None
    metadata_json: str = "{}"


@dataclass(slots=True)
class OrgChangeEventSourceKey:
    """Lookup key for one source-backed change event."""

    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    event_type: WatchEventType
    source_id: str


@dataclass(slots=True)
class OrgCoverageStatusChange:
    """Status transition for a watched coverage target."""

    org_id: str
    target_id: str
    target_name: str
    previous_status: str
    new_status: str


def _row_to_event(row: Any) -> OrgChangeEventModel:
    """Convert a database row into an OrgChangeEventModel."""
    return OrgChangeEventModel(
        id=str(row[0]),
        org_id=str(row[1]),
        resource_type=cast("WatchResourceType", row[2]),
        resource_id=str(row[3]),
        event_type=cast("WatchEventType", row[4]),
        title=str(row[5]),
        summary=str(row[6]),
        source_id=str(row[7]) if row[7] is not None else None,
        entry_id=str(row[8]) if row[8] is not None else None,
        coverage_target_id=str(row[9]) if row[9] is not None else None,
        metadata_json=str(row[10]),
        created_at=str(row[11]),
    )


class OrgChangeEventCRUD:
    """CRUD operations for workspace watch change events."""

    @staticmethod
    async def record(
        conn: aiosqlite.Connection,
        event_input: OrgChangeEventRecord,
    ) -> OrgChangeEventModel:
        """Record one change event unless an equivalent source event already exists."""
        if event_input.source_id is not None:
            existing = await OrgChangeEventCRUD.get_for_source(
                conn,
                OrgChangeEventSourceKey(
                    org_id=event_input.org_id,
                    resource_type=event_input.resource_type,
                    resource_id=event_input.resource_id,
                    event_type=event_input.event_type,
                    source_id=event_input.source_id,
                ),
            )
            if existing is not None:
                return existing

        event_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO org_change_events (
                id, org_id, resource_type, resource_id, event_type, title, summary,
                source_id, entry_id, coverage_target_id, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                event_input.org_id,
                event_input.resource_type,
                event_input.resource_id,
                event_input.event_type,
                event_input.title,
                event_input.summary,
                event_input.source_id,
                event_input.entry_id,
                event_input.coverage_target_id,
                event_input.metadata_json,
                created_at,
            ),
        )
        await conn.commit()
        event = await OrgChangeEventCRUD.get_by_id(conn, event_id)
        assert event is not None, "change event was just inserted"
        return event

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        event_id: str,
    ) -> OrgChangeEventModel | None:
        """Return one change event by id."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, resource_type, resource_id, event_type, title, summary,
                   source_id, entry_id, coverage_target_id, metadata_json, created_at
            FROM org_change_events
            WHERE id = ?
            """,
            (event_id,),
        )
        row = await cursor.fetchone()
        return _row_to_event(row) if row is not None else None

    @staticmethod
    async def get_for_source(
        conn: aiosqlite.Connection,
        source_key: OrgChangeEventSourceKey,
    ) -> OrgChangeEventModel | None:
        """Return an existing source-backed event for one watched resource."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, resource_type, resource_id, event_type, title, summary,
                   source_id, entry_id, coverage_target_id, metadata_json, created_at
            FROM org_change_events
            WHERE org_id = ?
              AND resource_type = ?
              AND resource_id = ?
              AND event_type = ?
              AND source_id = ?
            """,
            (
                source_key.org_id,
                source_key.resource_type,
                source_key.resource_id,
                source_key.event_type,
                source_key.source_id,
            ),
        )
        row = await cursor.fetchone()
        return _row_to_event(row) if row is not None else None

    @staticmethod
    async def record_entry_source_events(
        conn: aiosqlite.Connection,
        *,
        entry_id: str,
        source_id: str,
        summary: str | None = None,
    ) -> list[OrgChangeEventModel]:
        """Record new-source events for every non-muted workspace watching an entry."""
        entry_cursor = await conn.execute("SELECT name FROM entries WHERE id = ?", (entry_id,))
        entry_row = await entry_cursor.fetchone()
        if entry_row is None:
            return []

        watch_cursor = await conn.execute(
            """
            SELECT org_id
            FROM org_watches
            WHERE resource_type = 'entry'
              AND resource_id = ?
              AND notification_preference <> 'muted'
            ORDER BY org_id
            """,
            (entry_id,),
        )
        watch_rows = await watch_cursor.fetchall()
        return [
            await OrgChangeEventCRUD.record(
                conn,
                OrgChangeEventRecord(
                    org_id=str(watch_row[0]),
                    resource_type="entry",
                    resource_id=entry_id,
                    event_type="new_source",
                    title=f"New source for {entry_row[0]}",
                    summary=summary or "A new public source was linked to this actor.",
                    source_id=source_id,
                    entry_id=entry_id,
                ),
            )
            for watch_row in watch_rows
        ]

    @staticmethod
    async def record_coverage_status_event(
        conn: aiosqlite.Connection,
        status_change: OrgCoverageStatusChange,
    ) -> OrgChangeEventModel | None:
        """Record a coverage status event when the workspace watches the target."""
        if status_change.previous_status == status_change.new_status:
            return None

        watch_cursor = await conn.execute(
            """
            SELECT 1
            FROM org_watches
            WHERE org_id = ?
              AND resource_type = 'coverage_target'
              AND resource_id = ?
              AND notification_preference <> 'muted'
            LIMIT 1
            """,
            (status_change.org_id, status_change.target_id),
        )
        if await watch_cursor.fetchone() is None:
            return None

        return await OrgChangeEventCRUD.record(
            conn,
            OrgChangeEventRecord(
                org_id=status_change.org_id,
                resource_type="coverage_target",
                resource_id=status_change.target_id,
                event_type="coverage_status_changed",
                title=f"Coverage changed for {status_change.target_name}",
                summary=(
                    "Coverage changed from "
                    f"{status_change.previous_status} to {status_change.new_status}."
                ),
                coverage_target_id=status_change.target_id,
            ),
        )

    @staticmethod
    async def list_digest(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Return change events for resources the workspace currently watches."""
        cursor = await conn.execute(
            """
            SELECT
                oce.id,
                oce.org_id,
                oce.resource_type,
                oce.resource_id,
                oce.event_type,
                oce.title,
                oce.summary,
                oce.created_at,
                e.id AS entry_id,
                e.name AS entry_name,
                e.slug AS entry_slug,
                e.type AS entry_type,
                s.id AS source_id,
                s.url AS source_url,
                s.title AS source_title,
                s.publication AS source_publication,
                s.published_date AS source_published_date,
                s.type AS source_type
            FROM org_change_events oce
            JOIN org_watches ow
              ON ow.org_id = oce.org_id
             AND ow.resource_type = oce.resource_type
             AND ow.resource_id = oce.resource_id
             AND ow.notification_preference <> 'muted'
            LEFT JOIN entries e ON e.id = oce.entry_id
            LEFT JOIN sources s ON s.id = oce.source_id
            WHERE oce.org_id = ?
            ORDER BY oce.created_at DESC, oce.id DESC
            LIMIT ?
            """,
            (org_id, limit),
        )
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row, strict=False)) for row in rows]
