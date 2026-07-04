"""Workspace watch subscriptions for actors and coverage targets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

WatchResourceType = Literal["entry", "coverage_target"]
WatchNotificationPreference = Literal["digest", "immediate", "muted"]

__all__ = [
    "OrgWatchCRUD",
    "OrgWatchModel",
    "OrgWatchUpsert",
    "WatchNotificationPreference",
    "WatchResourceType",
]


@dataclass(slots=True)
class OrgWatchModel:
    """Workspace watch state for one resource."""

    id: str
    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    notification_preference: WatchNotificationPreference
    created_by: str
    created_at: str
    updated_at: str


@dataclass(slots=True)
class OrgWatchUpsert:
    """Input for creating or updating one workspace watch."""

    org_id: str
    resource_type: WatchResourceType
    resource_id: str
    created_by: str
    notification_preference: WatchNotificationPreference = "digest"


def _row_to_watch(row: Any) -> OrgWatchModel:
    """Convert a database row into an OrgWatchModel."""
    return OrgWatchModel(
        id=str(row[0]),
        org_id=str(row[1]),
        resource_type=cast("WatchResourceType", row[2]),
        resource_id=str(row[3]),
        notification_preference=cast("WatchNotificationPreference", row[4]),
        created_by=str(row[5]),
        created_at=str(row[6]),
        updated_at=str(row[7]),
    )


class OrgWatchCRUD:
    """CRUD operations for workspace watches."""

    @staticmethod
    async def upsert(
        conn: aiosqlite.Connection,
        watch_input: OrgWatchUpsert,
    ) -> OrgWatchModel:
        """Create or update a workspace watch."""
        watch_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO org_watches (
                id, org_id, resource_type, resource_id, notification_preference,
                created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(org_id, resource_type, resource_id) DO UPDATE SET
                notification_preference = excluded.notification_preference,
                updated_at = excluded.updated_at
            """,
            (
                watch_id,
                watch_input.org_id,
                watch_input.resource_type,
                watch_input.resource_id,
                watch_input.notification_preference,
                watch_input.created_by,
                now,
                now,
            ),
        )
        await conn.commit()
        watch = await OrgWatchCRUD.get(
            conn,
            org_id=watch_input.org_id,
            resource_type=watch_input.resource_type,
            resource_id=watch_input.resource_id,
        )
        assert watch is not None, "watch was just inserted or updated"
        return watch

    @staticmethod
    async def get(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        resource_type: WatchResourceType,
        resource_id: str,
    ) -> OrgWatchModel | None:
        """Return one workspace watch, if present."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, resource_type, resource_id, notification_preference,
                   created_by, created_at, updated_at
            FROM org_watches
            WHERE org_id = ? AND resource_type = ? AND resource_id = ?
            """,
            (org_id, resource_type, resource_id),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return _row_to_watch(row)

    @staticmethod
    async def list_by_org(
        conn: aiosqlite.Connection,
        org_id: str,
    ) -> list[OrgWatchModel]:
        """Return every watch for one workspace."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, resource_type, resource_id, notification_preference,
                   created_by, created_at, updated_at
            FROM org_watches
            WHERE org_id = ?
            ORDER BY updated_at DESC, resource_type ASC, resource_id ASC
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        return [_row_to_watch(row) for row in rows]

    @staticmethod
    async def delete(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        resource_type: WatchResourceType,
        resource_id: str,
    ) -> bool:
        """Delete one workspace watch."""
        cursor = await conn.execute(
            """
            DELETE FROM org_watches
            WHERE org_id = ? AND resource_type = ? AND resource_id = ?
            """,
            (org_id, resource_type, resource_id),
        )
        await conn.commit()
        return cursor.rowcount > 0
