"""Discovery run models and core CRUD helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db


@dataclass
class DiscoveryRunModel:
    """DiscoveryRun data model."""

    id: str
    location_query: str
    state: str
    research_goal: str
    issue_areas: list[str]
    queries_generated: int
    sources_fetched: int
    sources_processed: int
    entries_extracted: int
    entries_after_dedup: int
    entries_confirmed: int
    started_at: str
    completed_at: str | None
    status: str
    error_message: str | None
    created_at: str
    research_summary: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """
        Convert discovery run to dictionary.

        Returns
        -------
        dict[str, Any]
            Discovery run as dictionary.
        """
        return {
            "id": self.id,
            "location_query": self.location_query,
            "state": self.state,
            "research_goal": self.research_goal,
            "issue_areas": self.issue_areas,
            "queries_generated": self.queries_generated,
            "sources_fetched": self.sources_fetched,
            "sources_processed": self.sources_processed,
            "entries_extracted": self.entries_extracted,
            "entries_after_dedup": self.entries_after_dedup,
            "entries_confirmed": self.entries_confirmed,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "research_summary": self.research_summary,
        }


class DiscoveryRunCRUDCore:
    """CRUD operations for discovery runs."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        location_query: str,
        state: str,
        issue_areas: list[str],
        research_goal: str = "landscape_scan",
    ) -> str:
        """
        Create a new discovery run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        location_query : str
            Location query (e.g., "Kansas City, MO").
        state : str
            2-letter state code.
        issue_areas : list[str]
            List of issue area slugs being queried.
        research_goal : str, optional
            Research job this run is meant to support. Default is "landscape_scan".

        Returns
        -------
        str
            The created discovery run ID.
        """
        run_id = db.generate_uuid()
        now = db.now_iso()

        await conn.execute(
            """
            INSERT INTO discovery_runs (
                id, location_query, state, issue_areas, research_goal, started_at, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                location_query,
                state,
                db.encode_json(issue_areas),
                research_goal,
                now,
                "running",
                now,
            ),
        )
        await conn.commit()
        return run_id

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, run_id: str) -> DiscoveryRunModel | None:
        """
        Get a discovery run by ID.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.

        Returns
        -------
        DiscoveryRunModel | None
            The discovery run if found, None otherwise.
        """
        cursor = await conn.execute("SELECT * FROM discovery_runs WHERE id = ?", (run_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        data = dict(zip(columns, row, strict=False))
        return _row_to_discovery_run(data)

    @staticmethod
    async def list(
        conn: aiosqlite.Connection,
        state: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[DiscoveryRunModel]:
        """
        List discovery runs with optional filtering.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        state : str | None, optional
            Filter by state. Default is None.
        status : str | None, optional
            Filter by status (running, completed, failed). Default is None.
        limit : int, optional
            Result limit. Default is 50.
        offset : int, optional
            Result offset. Default is 0.

        Returns
        -------
        list[DiscoveryRunModel]
            List of discovery runs.
        """
        query = "SELECT * FROM discovery_runs WHERE 1=1"
        params: list[Any] = []

        if state:
            query += " AND state = ?"
            params.append(state)
        if status:
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY started_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()

        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        return [_row_to_discovery_run(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def count(
        conn: aiosqlite.Connection,
        state: str | None = None,
        status: str | None = None,
    ) -> int:
        """Count discovery runs with optional filtering."""
        query = "SELECT COUNT(*) FROM discovery_runs WHERE 1=1"
        params: list[Any] = []
        if state:
            query += " AND state = ?"
            params.append(state)
        if status:
            query += " AND status = ?"
            params.append(status)
        cursor = await conn.execute(query, params)
        row = await cursor.fetchone()
        return int(row[0] or 0) if row else 0

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        run_id: str,
        **kwargs: object,
    ) -> bool:
        """
        Update a discovery run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        **kwargs : object
            Fields to update.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        allowed_fields = {
            "queries_generated",
            "sources_fetched",
            "sources_processed",
            "entries_extracted",
            "entries_after_dedup",
            "entries_confirmed",
            "completed_at",
            "status",
            "error_message",
            "research_summary",
        }

        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        if "research_summary" in fields_to_update:
            fields_to_update["research_summary"] = db.encode_json(
                fields_to_update["research_summary"]
            )

        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), run_id]

        cursor = await conn.execute(
            f"UPDATE discovery_runs SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0


def _row_to_discovery_run(row: dict[str, Any]) -> DiscoveryRunModel:
    """Convert database row to DiscoveryRunModel."""
    research_summary = row.get("research_summary")
    return DiscoveryRunModel(
        id=row["id"],
        location_query=row["location_query"],
        state=row["state"],
        research_goal=row.get("research_goal", "landscape_scan"),
        issue_areas=db.decode_json(row["issue_areas"]),  # type: ignore[arg-type]
        queries_generated=row["queries_generated"],
        sources_fetched=row["sources_fetched"],
        sources_processed=row["sources_processed"],
        entries_extracted=row["entries_extracted"],
        entries_after_dedup=row["entries_after_dedup"],
        entries_confirmed=row["entries_confirmed"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        status=row["status"],
        error_message=row["error_message"],
        created_at=row["created_at"],
        research_summary=(
            db.decode_json(research_summary)  # type: ignore[arg-type]
            if research_summary
            else None
        ),
    )
