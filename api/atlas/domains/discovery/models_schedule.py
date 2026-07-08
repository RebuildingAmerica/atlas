"""Discovery schedule models and CRUD helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db


@dataclass
class DiscoveryScheduleModel:
    """A scheduled discovery target."""

    id: str
    location_query: str
    state: str
    issue_areas: list[str]
    search_depth: str
    enabled: bool
    last_run_id: str | None
    last_run_at: str | None
    created_at: str
    updated_at: str


class DiscoveryScheduleCRUD:
    """CRUD operations for discovery schedule targets."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        *,
        location_query: str,
        state: str,
        issue_areas: list[str],
        search_depth: str = "standard",
    ) -> str:
        """Create a new schedule target. Returns the schedule ID."""
        schedule_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO discovery_schedules (
                id, location_query, state, issue_areas, search_depth,
                enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                schedule_id,
                location_query,
                state,
                db.encode_json(issue_areas),
                search_depth,
                now,
                now,
            ),
        )
        await conn.commit()
        return schedule_id

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection, schedule_id: str
    ) -> DiscoveryScheduleModel | None:
        """Get a schedule target by ID."""
        cursor = await conn.execute(
            "SELECT * FROM discovery_schedules WHERE id = ?", (schedule_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_schedule(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def list(
        conn: aiosqlite.Connection,
        *,
        enabled_only: bool = False,
        limit: int = 100,
    ) -> list[DiscoveryScheduleModel]:
        """List schedule targets."""
        query = "SELECT * FROM discovery_schedules"
        params: list[Any] = []
        if enabled_only:
            query += " WHERE enabled = 1"
        query += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [col[0] for col in cursor.description]
        return [_row_to_discovery_schedule(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        schedule_id: str,
        **kwargs: object,
    ) -> bool:
        """Update a schedule target. Returns True if updated."""
        allowed_fields = {
            "location_query",
            "state",
            "issue_areas",
            "search_depth",
            "enabled",
            "last_run_id",
            "last_run_at",
        }
        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        if "issue_areas" in fields_to_update:
            fields_to_update["issue_areas"] = db.encode_json(fields_to_update["issue_areas"])
        if "enabled" in fields_to_update:
            fields_to_update["enabled"] = 1 if fields_to_update["enabled"] else 0

        fields_to_update["updated_at"] = db.now_iso()
        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), schedule_id]
        cursor = await conn.execute(
            f"UPDATE discovery_schedules SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def delete(conn: aiosqlite.Connection, schedule_id: str) -> bool:
        """Delete a schedule target. Returns True if deleted."""
        cursor = await conn.execute("DELETE FROM discovery_schedules WHERE id = ?", (schedule_id,))
        await conn.commit()
        return cursor.rowcount > 0


def _row_to_discovery_schedule(row: dict[str, Any]) -> DiscoveryScheduleModel:
    """Convert database row to DiscoveryScheduleModel."""
    enabled_raw = row["enabled"]
    enabled = bool(enabled_raw) if isinstance(enabled_raw, int) else enabled_raw is True
    return DiscoveryScheduleModel(
        id=row["id"],
        location_query=row["location_query"],
        state=row["state"],
        issue_areas=db.decode_json(row["issue_areas"]),  # type: ignore[arg-type]
        search_depth=row["search_depth"],
        enabled=enabled,
        last_run_id=row.get("last_run_id"),
        last_run_at=row.get("last_run_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
