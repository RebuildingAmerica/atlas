"""Workspace usage events for renewal summaries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

OrgUsageEventType = Literal[
    "brief_opened",
    "brief_exported",
    "evidence_opened",
    "list_item_saved",
    "watch_created",
    "coverage_report_exported",
    "coverage_target_created",
    "scout_artifacts_synced",
    "digest_viewed",
    "coverage_gap_closed",
    "api_call",
    "public_record_improved",
]

OrgUsageResourceType = Literal[
    "brief",
    "source",
    "saved_list",
    "watch",
    "digest",
    "coverage_target",
    "coverage_report",
    "discovery_run",
    "api",
    "public_record",
]

__all__ = [
    "OrgIntegrationResourceUsage",
    "OrgIntegrationSurface",
    "OrgIntegrationSurfaceCounts",
    "OrgUsageEventCRUD",
    "OrgUsageEventModel",
    "OrgUsageEventRecord",
    "OrgUsageEventType",
    "OrgUsageResourceType",
]

OrgIntegrationSurface = Literal["api", "mcp"]


@dataclass(slots=True)
class OrgUsageEventModel:
    """A non-invasive product-usage signal for one workspace."""

    id: str
    org_id: str
    actor_id: str | None
    event_type: OrgUsageEventType
    resource_type: OrgUsageResourceType | None
    resource_id: str | None
    metadata_json: str
    created_at: str


@dataclass(slots=True)
class OrgUsageEventRecord:
    """Input for recording one workspace usage event."""

    org_id: str
    actor_id: str | None
    event_type: OrgUsageEventType
    resource_type: OrgUsageResourceType | None = None
    resource_id: str | None = None
    metadata_json: str = "{}"


@dataclass(slots=True)
class OrgIntegrationSurfaceCounts:
    """Integration call counts grouped by API surface."""

    total_calls: int
    api_calls: int
    mcp_calls: int
    last_seen_at: str | None


@dataclass(slots=True)
class OrgIntegrationResourceUsage:
    """Integration call counts for one route or MCP resource."""

    resource_id: str
    surface: OrgIntegrationSurface
    total_calls: int
    last_seen_at: str


def _row_to_usage_event(row: Any) -> OrgUsageEventModel:
    """Convert a database row into an OrgUsageEventModel."""
    return OrgUsageEventModel(
        id=str(row[0]),
        org_id=str(row[1]),
        actor_id=str(row[2]) if row[2] is not None else None,
        event_type=cast("OrgUsageEventType", row[3]),
        resource_type=cast("OrgUsageResourceType", row[4]) if row[4] is not None else None,
        resource_id=str(row[5]) if row[5] is not None else None,
        metadata_json=str(row[6]),
        created_at=str(row[7]),
    )


def _integration_surface_sql() -> str:
    """Return portable SQL that classifies API-call events by integration surface."""
    return """
        CASE
            WHEN resource_id = '/mcp'
              OR LOWER(REPLACE(metadata_json, ' ', '')) LIKE '%"surface":"mcp"%'
            THEN 'mcp'
            ELSE 'api'
        END
    """


def _escape_sql_like(value: str) -> str:
    """Escape LIKE wildcards in a value that will be embedded in a pattern."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _row_to_integration_resource_usage(row: Any) -> OrgIntegrationResourceUsage:
    """Convert a grouped integration resource row into a usage rollup."""
    surface: OrgIntegrationSurface = "mcp" if str(row[1]) == "mcp" else "api"
    return OrgIntegrationResourceUsage(
        resource_id=str(row[0]),
        surface=surface,
        total_calls=int(row[2]),
        last_seen_at=str(row[3]),
    )


class OrgUsageEventCRUD:
    """CRUD operations for workspace renewal usage events."""

    @staticmethod
    async def record(
        conn: aiosqlite.Connection,
        event_input: OrgUsageEventRecord,
    ) -> OrgUsageEventModel:
        """Record one workspace usage event."""
        event_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO org_usage_events (
                id, org_id, actor_id, event_type, resource_type, resource_id,
                metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                event_input.org_id,
                event_input.actor_id,
                event_input.event_type,
                event_input.resource_type,
                event_input.resource_id,
                event_input.metadata_json,
                created_at,
            ),
        )
        await conn.commit()
        event = await OrgUsageEventCRUD.get_by_id(conn, event_id)
        assert event is not None, "usage event was just inserted"
        return event

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        event_id: str,
    ) -> OrgUsageEventModel | None:
        """Return one usage event by id."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, actor_id, event_type, resource_type, resource_id,
                   metadata_json, created_at
            FROM org_usage_events
            WHERE id = ?
            """,
            (event_id,),
        )
        row = await cursor.fetchone()
        return _row_to_usage_event(row) if row is not None else None

    @staticmethod
    async def count_by_type(conn: aiosqlite.Connection, *, org_id: str) -> dict[str, int]:
        """Return usage-event counts grouped by event type for one workspace."""
        cursor = await conn.execute(
            """
            SELECT event_type, COUNT(*) AS event_count
            FROM org_usage_events
            WHERE org_id = ?
            GROUP BY event_type
            ORDER BY event_type
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        return {str(row[0]): int(row[1]) for row in rows}

    @staticmethod
    async def count_by_org(conn: aiosqlite.Connection, *, org_id: str) -> int:
        """Return the total usage-event count for one workspace."""
        cursor = await conn.execute(
            """
            SELECT COUNT(*)
            FROM org_usage_events
            WHERE org_id = ?
            """,
            (org_id,),
        )
        row = await cursor.fetchone()
        return int(row[0]) if row is not None else 0

    @staticmethod
    async def count_api_key_calls_since(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        api_key_id: str,
        since: str,
    ) -> int:
        """Return API-call usage for one API key from a timestamp onward."""
        normalized_api_key_id = _escape_sql_like(api_key_id.lower())
        cursor = await conn.execute(
            """
            SELECT COUNT(*)
            FROM org_usage_events
            WHERE org_id = ?
              AND event_type = 'api_call'
              AND created_at >= ?
              AND LOWER(REPLACE(metadata_json, ' ', '')) LIKE ? ESCAPE '\\'
            """,
            (org_id, since, f'%"api_key_id":"{normalized_api_key_id}"%'),
        )
        row = await cursor.fetchone()
        return int(row[0]) if row is not None else 0

    @staticmethod
    async def list_by_org(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        limit: int,
        offset: int,
    ) -> list[OrgUsageEventModel]:
        """Return recent usage events for one workspace."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, actor_id, event_type, resource_type, resource_id,
                   metadata_json, created_at
            FROM org_usage_events
            WHERE org_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (org_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [_row_to_usage_event(row) for row in rows]

    @staticmethod
    async def list_api_calls_by_org(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
    ) -> list[OrgUsageEventModel]:
        """Return integration usage events for one workspace."""
        cursor = await conn.execute(
            """
            SELECT id, org_id, actor_id, event_type, resource_type, resource_id,
                   metadata_json, created_at
            FROM org_usage_events
            WHERE org_id = ? AND event_type = 'api_call'
            ORDER BY created_at DESC, id DESC
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        return [_row_to_usage_event(row) for row in rows]

    @staticmethod
    async def count_integration_calls_by_surface(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
    ) -> OrgIntegrationSurfaceCounts:
        """Return API/MCP integration counts without loading raw usage events."""
        surface_sql = _integration_surface_sql()
        cursor = await conn.execute(
            f"""
            SELECT surface, COUNT(*) AS total_calls, MAX(created_at) AS last_seen_at
            FROM (
                SELECT {surface_sql} AS surface, created_at
                FROM org_usage_events
                WHERE org_id = ? AND event_type = 'api_call'
            ) integration_events
            GROUP BY surface
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        api_calls = 0
        mcp_calls = 0
        last_seen_at: str | None = None

        for row in rows:
            surface = str(row[0])
            total_calls = int(row[1])
            row_last_seen_at = str(row[2]) if row[2] is not None else None
            if surface == "mcp":
                mcp_calls = total_calls
            else:
                api_calls = total_calls
            if row_last_seen_at is not None and (
                last_seen_at is None or row_last_seen_at > last_seen_at
            ):
                last_seen_at = row_last_seen_at

        return OrgIntegrationSurfaceCounts(
            total_calls=api_calls + mcp_calls,
            api_calls=api_calls,
            mcp_calls=mcp_calls,
            last_seen_at=last_seen_at,
        )

    @staticmethod
    async def list_top_integration_resources(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        limit: int = 10,
    ) -> list[OrgIntegrationResourceUsage]:
        """Return top integration route/tool rollups without loading raw events."""
        surface_sql = _integration_surface_sql()
        cursor = await conn.execute(
            f"""
            SELECT
                resource_id,
                surface,
                COUNT(*) AS total_calls,
                MAX(created_at) AS last_seen_at
            FROM (
                SELECT
                    COALESCE(resource_id, 'unknown') AS resource_id,
                    {surface_sql} AS surface,
                    created_at
                FROM org_usage_events
                WHERE org_id = ? AND event_type = 'api_call'
            ) integration_events
            GROUP BY surface, resource_id
            ORDER BY total_calls DESC, surface ASC, resource_id ASC
            LIMIT ?
            """,
            (org_id, limit),
        )
        rows = await cursor.fetchall()
        return [_row_to_integration_resource_usage(row) for row in rows]
