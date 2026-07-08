"""Entry listing and source hydration helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .entry_model import EntryModel, _row_to_entry

if TYPE_CHECKING:
    from builtins import list as builtin_list

    import aiosqlite


class EntryListingMixin:
    """Listing, filtering, and related-source helpers for entries."""

    @staticmethod
    async def list(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        state: str | None = None,
        city: str | None = None,
        entry_type: str | None = None,
        active_only: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> builtin_list[EntryModel]:
        """
        List entries with optional filtering.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        state : str | None, optional
            Filter by state. Default is None.
        city : str | None, optional
            Filter by city. Default is None.
        entry_type : str | None, optional
            Filter by type. Default is None.
        active_only : bool, optional
            Only include active entries. Default is True.
        limit : int, optional
            Result limit. Default is 100.
        offset : int, optional
            Result offset. Default is 0.

        Returns
        -------
        list[EntryModel]
            List of entries.
        """
        query = "SELECT * FROM entries WHERE 1=1"
        params: builtin_list[Any] = []

        if active_only:
            query += " AND active = TRUE"
        if state:
            query += " AND state = ?"
            params.append(state)
        if city:
            query += " AND city = ?"
            params.append(city)
        if entry_type:
            query += " AND type = ?"
            params.append(entry_type)

        query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()

        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        return [_row_to_entry(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def search_fts(
        conn: aiosqlite.Connection,
        query: str,
        limit: int = 50,
    ) -> builtin_list[EntryModel]:
        """
        Full-text search entries by name and description.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        query : str
            Search query.
        limit : int, optional
            Result limit. Default is 50.

        Returns
        -------
        list[EntryModel]
            Matching entries.
        """
        if getattr(conn, "backend", None) == "postgres":
            sql = """
                SELECT e.* FROM entries e
                WHERE e.search_vector @@ plainto_tsquery('english', ?)
                LIMIT ?
            """
        else:
            sql = """
                SELECT e.* FROM entries e
                JOIN entries_fts fts ON e.rowid = fts.rowid
                WHERE entries_fts MATCH ?
                LIMIT ?
            """
        cursor = await conn.execute(sql, (query, limit))
        rows = await cursor.fetchall()

        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        return [_row_to_entry(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def filter_by_issue_area(
        conn: aiosqlite.Connection,
        issue_area: str,
        state: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> builtin_list[EntryModel]:
        """
        Get entries for a specific issue area.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        issue_area : str
            Issue area slug.
        state : str | None, optional
            Filter by state. Default is None.
        limit : int, optional
            Result limit. Default is 100.
        offset : int, optional
            Result offset. Default is 0.

        Returns
        -------
        list[EntryModel]
            Entries tagged with the issue area.
        """
        query = """
            SELECT DISTINCT e.* FROM entries e
            JOIN entry_issue_areas eia ON e.id = eia.entry_id
            WHERE eia.issue_area = ? AND e.active = TRUE
        """
        params: list[Any] = [issue_area]

        if state:
            query += " AND e.state = ?"
            params.append(state)

        query += " ORDER BY e.updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()

        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        return [_row_to_entry(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def get_with_sources(
        conn: aiosqlite.Connection, entry_id: str
    ) -> tuple[EntryModel | None, builtin_list[dict[str, Any]]]:
        """
        Get an entry with its sources.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.

        Returns
        -------
        tuple[EntryModel | None, list[dict[str, Any]]]
            The entry and list of sources, or (None, []).
        """
        cursor = await conn.execute(
            """
            SELECT * FROM entries WHERE id = ?
            """,
            (entry_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None, []

        columns = [col[0] for col in cursor.description]
        entry = _row_to_entry(dict(zip(columns, row, strict=False)))

        cursor = await conn.execute(
            """
            SELECT s.*, es.extraction_context FROM sources s
            JOIN entry_sources es ON s.id = es.source_id
            WHERE es.entry_id = ?
            ORDER BY s.ingested_at DESC
            """,
            (entry_id,),
        )
        rows = await cursor.fetchall()

        if not rows:
            return entry, []

        columns = [col[0] for col in cursor.description]
        sources = [dict(zip(columns, row, strict=False)) for row in rows]
        return entry, sources

    @staticmethod
    async def get_issue_areas(conn: aiosqlite.Connection, entry_id: str) -> builtin_list[str]:
        """
        Get the issue-area slugs linked to an entry.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.

        Returns
        -------
        list[str]
            Linked issue-area slugs.
        """
        cursor = await conn.execute(
            """
            SELECT issue_area
            FROM entry_issue_areas
            WHERE entry_id = ?
            ORDER BY issue_area ASC
            """,
            (entry_id,),
        )
        rows = await cursor.fetchall()
        return [row[0] for row in rows]
