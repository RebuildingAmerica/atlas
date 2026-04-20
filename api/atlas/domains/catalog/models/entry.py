"""
Entry model and CRUD operations.

Entries are the core entity in The Atlas: people, organizations, initiatives,
campaigns, and events tied to a place and set of issues.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

if TYPE_CHECKING:
    import builtins
    from collections.abc import Sequence

    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["EntryCRUD", "EntryModel"]


@dataclass
class EntryModel:
    """Entry data model."""

    id: str
    type: str
    name: str
    description: str
    city: str | None
    state: str | None
    region: str | None
    geo_specificity: str
    full_address: str | None
    website: str | None
    email: str | None
    phone: str | None
    social_media: dict[str, str] | None
    affiliated_org_id: str | None
    active: bool
    verified: bool
    last_verified: date | None
    contact_status: str
    editorial_notes: str | None
    priority: str | None
    first_seen: date
    last_seen: date
    created_at: str
    updated_at: str

    def to_dict(self, include_internal: bool = True) -> dict[str, Any]:
        """
        Convert entry to dictionary.

        Parameters
        ----------
        include_internal : bool, optional
            Include internal fields (contact_status, editorial_notes, priority).
            Default is True.

        Returns
        -------
        dict[str, Any]
            Entry as dictionary.
        """
        result = {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "description": self.description,
            "city": self.city,
            "state": self.state,
            "region": self.region,
            "geo_specificity": self.geo_specificity,
            "full_address": self.full_address,
            "website": self.website,
            "email": self.email,
            "phone": self.phone,
            "social_media": self.social_media,
            "affiliated_org_id": self.affiliated_org_id,
            "active": self.active,
            "verified": self.verified,
            "last_verified": self.last_verified.isoformat() if self.last_verified else None,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if include_internal:
            result.update(
                {
                    "contact_status": self.contact_status,
                    "editorial_notes": self.editorial_notes,
                    "priority": self.priority,
                }
            )
        return result


class EntryCRUD:
    """CRUD operations for entries."""

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        entry_type: str,
        name: str,
        description: str,
        city: str | None,
        state: str | None,
        geo_specificity: str,
        region: str | None = None,
        full_address: str | None = None,
        website: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        social_media: dict[str, str] | None = None,
        affiliated_org_id: str | None = None,
        first_seen: date | None = None,
        last_seen: date | None = None,
        contact_status: str = "not_contacted",
        editorial_notes: str | None = None,
        priority: str | None = None,
    ) -> str:
        """
        Create a new entry.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_type : str
            Type of entry (person, organization, initiative, campaign, event).
        name : str
            Entry name.
        description : str
            1-3 sentence description.
        city : str | None
            City (can be None for national entries).
        state : str | None
            2-letter state code (can be None for national entries).
        geo_specificity : str
            Geographic scope (local, regional, statewide, national).
        region : str | None, optional
            Regional identifier (e.g., "Kansas City metro"). Default is None.
        full_address : str | None, optional
            Public-facing full mailing or street address. Default is None.
        website : str | None, optional
            Website URL. Default is None.
        email : str | None, optional
            Email address. Default is None.
        phone : str | None, optional
            Phone number. Default is None.
        social_media : dict[str, str] | None, optional
            Social media handles {platform: handle}. Default is None.
        affiliated_org_id : str | None, optional
            ID of affiliated organization. Default is None.
        first_seen : date | None, optional
            First discovery date. Defaults to today.
        last_seen : date | None, optional
            Last discovery date. Defaults to today.
        contact_status : str, optional
            Contact status. Default is "not_contacted".
        editorial_notes : str | None, optional
            Internal notes. Default is None.
        priority : str | None, optional
            Priority level (high, medium, low). Default is None.

        Returns
        -------
        str
            The created entry ID.
        """
        entry_id = db.generate_uuid()
        now = db.now_iso()
        today = datetime.now(tz=UTC).date()
        first_seen_val = first_seen or today
        last_seen_val = last_seen or today

        await conn.execute(
            """
            INSERT INTO entries (
                id, type, name, description, city, state, region,
                geo_specificity, full_address, website, email, phone, social_media,
                affiliated_org_id, contact_status, editorial_notes, priority,
                first_seen, last_seen, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                entry_type,
                name,
                description,
                city,
                state,
                region,
                geo_specificity,
                full_address,
                website,
                email,
                phone,
                db.encode_json(social_media) if social_media else None,
                affiliated_org_id,
                contact_status,
                editorial_notes,
                priority,
                first_seen_val.isoformat(),
                last_seen_val.isoformat(),
                now,
                now,
            ),
        )
        await conn.commit()
        return entry_id

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, entry_id: str) -> EntryModel | None:
        """
        Get an entry by ID.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.

        Returns
        -------
        EntryModel | None
            The entry if found, None otherwise.
        """
        cursor = await conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        data = dict(zip(columns, row, strict=False))

        return _row_to_entry(data)

    @staticmethod
    async def list(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        state: str | None = None,
        city: str | None = None,
        entry_type: str | None = None,
        active_only: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> builtins.list[EntryModel]:
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
        params: builtins.list[Any] = []

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
    ) -> builtins.list[EntryModel]:
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
    ) -> builtins.list[EntryModel]:
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
        params: builtins.list[Any] = [issue_area]

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
    async def update(
        conn: aiosqlite.Connection,
        entry_id: str,
        **kwargs: object,
    ) -> bool:
        """
        Update an entry.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.
        **kwargs : object
            Fields to update.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        allowed_fields = {
            "name",
            "description",
            "city",
            "state",
            "region",
            "geo_specificity",
            "full_address",
            "website",
            "email",
            "phone",
            "social_media",
            "active",
            "verified",
            "last_verified",
            "contact_status",
            "editorial_notes",
            "priority",
            "last_seen",
        }

        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        fields_to_update["updated_at"] = db.now_iso()

        # Handle JSON encoding for social_media
        if fields_to_update.get("social_media"):
            fields_to_update["social_media"] = db.encode_json(fields_to_update["social_media"])
        last_verified_val = fields_to_update.get("last_verified")
        if isinstance(last_verified_val, date):
            fields_to_update["last_verified"] = last_verified_val.isoformat()
        last_seen_val = fields_to_update.get("last_seen")
        if isinstance(last_seen_val, date):
            fields_to_update["last_seen"] = last_seen_val.isoformat()

        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), entry_id]

        cursor = await conn.execute(
            f"UPDATE entries SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def delete(conn: aiosqlite.Connection, entry_id: str) -> bool:
        """
        Delete an entry (cascade deletes related records).

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.

        Returns
        -------
        bool
            True if deleted, False if not found.
        """
        cursor = await conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def get_with_sources(
        conn: aiosqlite.Connection, entry_id: str
    ) -> tuple[EntryModel | None, builtins.list[dict[str, Any]]]:
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
        tuple[EntryModel | None, builtins.list[dict[str, Any]]]
            The entry and list of sources, or (None, []).
        """
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        if not entry:
            return None, []

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
    async def get_issue_areas(conn: aiosqlite.Connection, entry_id: str) -> builtins.list[str]:
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
        builtins.list[str]
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

    @staticmethod
    async def get_issue_areas_for_entries(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
    ) -> dict[str, builtins.list[str]]:
        """
        Get issue-area slugs for multiple entries.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_ids : builtins.list[str]
            Entry IDs to load.

        Returns
        -------
        dict[str, builtins.list[str]]
            Entry ID to linked issue-area slugs.
        """
        if not entry_ids:
            return {}

        placeholders = _make_placeholders(entry_ids)
        cursor = await conn.execute(
            f"""
            SELECT entry_id, issue_area
            FROM entry_issue_areas
            WHERE entry_id IN ({placeholders})
            ORDER BY issue_area ASC
            """,
            entry_ids,
        )
        rows = await cursor.fetchall()
        result: dict[str, builtins.list[str]] = {entry_id: [] for entry_id in entry_ids}
        for entry_id, issue_area in rows:
            result.setdefault(entry_id, []).append(issue_area)
        return result

    @staticmethod
    async def get_sources_for_entries(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
    ) -> dict[str, builtins.list[dict[str, Any]]]:
        """
        Get linked sources for multiple entries.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_ids : list[str]
            Entry IDs to load.

        Returns
        -------
        dict[str, list[dict[str, Any]]]
            Entry ID to linked source dictionaries.
        """
        if not entry_ids:
            return {}

        placeholders = _make_placeholders(entry_ids)
        cursor = await conn.execute(
            f"""
            SELECT
                es.entry_id,
                s.id,
                s.url,
                s.title,
                s.publication,
                s.published_date,
                s.type,
                s.ingested_at,
                s.extraction_method,
                s.created_at,
                es.extraction_context
            FROM entry_sources es
            JOIN sources s ON s.id = es.source_id
            WHERE es.entry_id IN ({placeholders})
            ORDER BY COALESCE(s.published_date, substr(s.ingested_at, 1, 10)) DESC, s.ingested_at DESC
            """,
            entry_ids,
        )
        rows = await cursor.fetchall()
        result: dict[str, builtins.list[dict[str, Any]]] = {entry_id: [] for entry_id in entry_ids}
        for row in rows:
            result.setdefault(row[0], []).append(
                {
                    "id": row[1],
                    "url": row[2],
                    "title": row[3],
                    "publication": row[4],
                    "published_date": row[5],
                    "type": row[6],
                    "ingested_at": row[7],
                    "extraction_method": row[8],
                    "created_at": row[9],
                    "extraction_context": row[10],
                }
            )
        return result

    @staticmethod
    async def search_public(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        query: str | None = None,
        states: builtins.list[str] | None = None,
        cities: builtins.list[str] | None = None,
        regions: builtins.list[str] | None = None,
        issue_areas: builtins.list[str] | None = None,
        entry_types: builtins.list[str] | None = None,
        source_types: builtins.list[str] | None = None,
        affiliated_org_id: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Search public-facing entry results with multi-dimensional filters.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        query : str | None, optional
            Full-text query against name and description. Default is None.
        states : builtins.list[str] | None, optional
            State filters. Default is None.
        cities : builtins.list[str] | None, optional
            City filters. Default is None.
        regions : builtins.list[str] | None, optional
            Region filters. Default is None.
        issue_areas : builtins.list[str] | None, optional
            Issue-area filters. Default is None.
        entry_types : builtins.list[str] | None, optional
            Entry-type filters. Default is None.
        source_types : builtins.list[str] | None, optional
            Source-type filters. Default is None.
        limit : int, optional
            Page size. Default is 20.
        offset : int, optional
            Page offset. Default is 0.

        Returns
        -------
        dict[str, Any]
            Search results, pagination metadata, and facet counts.
        """
        matched_ids = await EntryCRUD._search_public_ids(
            conn,
            query=query,
            states=states,
            cities=cities,
            regions=regions,
            issue_areas=issue_areas,
            entry_types=entry_types,
            source_types=source_types,
            affiliated_org_id=affiliated_org_id,
        )

        if not matched_ids:
            return {
                "entries": [],
                "total": 0,
                "facets": _empty_facets(),
            }

        paged_records = await EntryCRUD._load_entries_with_metrics(
            conn,
            entry_ids=matched_ids,
            limit=limit,
            offset=offset,
        )
        page_entry_ids = [record["entry"].id for record in paged_records]
        issue_map = await EntryCRUD.get_issue_areas_for_entries(conn, page_entry_ids)
        source_map = await EntryCRUD.get_sources_for_entries(conn, page_entry_ids)
        facets = await EntryCRUD._build_facets(conn, matched_ids)

        entries = []
        for record in paged_records:
            entry = record["entry"]
            sources = source_map.get(entry.id, [])
            entries.append(
                {
                    "entry": entry,
                    "issue_areas": issue_map.get(entry.id, []),
                    "source_types": sorted({source["type"] for source in sources}),
                    "source_count": record["source_count"],
                    "latest_source_date": record["latest_source_date"],
                }
            )

        return {
            "entries": entries,
            "total": len(matched_ids),
            "facets": facets,
        }

    @staticmethod
    async def _search_public_ids(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        query: str | None = None,
        states: builtins.list[str] | None = None,
        cities: builtins.list[str] | None = None,
        regions: builtins.list[str] | None = None,
        issue_areas: builtins.list[str] | None = None,
        entry_types: builtins.list[str] | None = None,
        source_types: builtins.list[str] | None = None,
        affiliated_org_id: str | None = None,
    ) -> builtins.list[str]:
        query_sql = """
            SELECT DISTINCT e.id
            FROM entries e
            LEFT JOIN entry_issue_areas eia ON e.id = eia.entry_id
            LEFT JOIN entry_sources es ON e.id = es.entry_id
            LEFT JOIN sources s ON es.source_id = s.id
            WHERE e.active = TRUE
        """
        params: builtins.list[Any] = []

        if query:
            if getattr(conn, "backend", None) == "postgres":
                query_sql += """
                    AND e.search_vector @@ plainto_tsquery('english', ?)
                """
            else:
                query_sql += """
                    AND e.rowid IN (
                        SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?
                    )
                """
            params.append(query)
        if states:
            query_sql += f" AND e.state IN ({_make_placeholders(states)})"
            params.extend(states)
        if cities:
            query_sql += f" AND e.city IN ({_make_placeholders(cities)})"
            params.extend(cities)
        if regions:
            query_sql += f" AND e.region IN ({_make_placeholders(regions)})"
            params.extend(regions)
        if issue_areas:
            query_sql += f" AND eia.issue_area IN ({_make_placeholders(issue_areas)})"
            params.extend(issue_areas)
        if entry_types:
            query_sql += f" AND e.type IN ({_make_placeholders(entry_types)})"
            params.extend(entry_types)
        if source_types:
            query_sql += f" AND s.type IN ({_make_placeholders(source_types)})"
            params.extend(source_types)
        if affiliated_org_id:
            query_sql += " AND e.affiliated_org_id = ?"
            params.append(affiliated_org_id)

        cursor = await conn.execute(query_sql, params)
        rows = await cursor.fetchall()
        return [row[0] for row in rows]

    @staticmethod
    async def _load_entries_with_metrics(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
        limit: int,
        offset: int,
    ) -> builtins.list[dict[str, Any]]:
        if not entry_ids:
            return []

        placeholders = _make_placeholders(entry_ids)
        cursor = await conn.execute(
            f"""
            SELECT
                e.*,
                COUNT(DISTINCT es.source_id) AS source_count,
                MAX(COALESCE(s.published_date, substr(s.ingested_at, 1, 10), e.last_seen)) AS latest_source_date
            FROM entries e
            LEFT JOIN entry_sources es ON e.id = es.entry_id
            LEFT JOIN sources s ON es.source_id = s.id
            WHERE e.id IN ({placeholders})
            GROUP BY e.id
            ORDER BY source_count DESC, latest_source_date DESC, e.verified DESC, e.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            [*entry_ids, limit, offset],
        )
        rows = await cursor.fetchall()
        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        records = []
        for row in rows:
            data = dict(zip(columns, row, strict=False))
            records.append(
                {
                    "entry": _row_to_entry(data),
                    "source_count": int(data["source_count"] or 0),
                    "latest_source_date": data["latest_source_date"],
                }
            )
        return records

    @staticmethod
    async def _build_facets(
        conn: aiosqlite.Connection,
        entry_ids: builtins.list[str],
    ) -> dict[str, builtins.list[dict[str, Any]]]:
        if not entry_ids:
            return _empty_facets()

        placeholders = _make_placeholders(entry_ids)
        params = entry_ids

        async def fetch_pairs(
            sql: str, query_params: builtins.list[Any]
        ) -> builtins.list[tuple[Any, Any]]:
            cursor = await conn.execute(sql, query_params)
            return await cursor.fetchall()  # type: ignore[return-value]

        state_rows = await fetch_pairs(
            f"""
            SELECT state, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders}) AND state IS NOT NULL
            GROUP BY state
            ORDER BY COUNT(*) DESC, state ASC
            """,
            params,
        )
        city_rows = await fetch_pairs(
            f"""
            SELECT city, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders}) AND city IS NOT NULL
            GROUP BY city
            ORDER BY COUNT(*) DESC, city ASC
            """,
            params,
        )
        region_rows = await fetch_pairs(
            f"""
            SELECT region, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders}) AND region IS NOT NULL
            GROUP BY region
            ORDER BY COUNT(*) DESC, region ASC
            """,
            params,
        )
        issue_rows = await fetch_pairs(
            f"""
            SELECT issue_area, COUNT(*)
            FROM entry_issue_areas
            WHERE entry_id IN ({placeholders})
            GROUP BY issue_area
            ORDER BY COUNT(*) DESC, issue_area ASC
            """,
            params,
        )
        type_rows = await fetch_pairs(
            f"""
            SELECT type, COUNT(*)
            FROM entries
            WHERE id IN ({placeholders})
            GROUP BY type
            ORDER BY COUNT(*) DESC, type ASC
            """,
            params,
        )
        source_type_rows = await fetch_pairs(
            f"""
            SELECT s.type, COUNT(DISTINCT es.entry_id)
            FROM entry_sources es
            JOIN sources s ON s.id = es.source_id
            WHERE es.entry_id IN ({placeholders})
            GROUP BY s.type
            ORDER BY COUNT(DISTINCT es.entry_id) DESC, s.type ASC
            """,
            params,
        )

        return {
            "states": _facet_rows_to_dicts(state_rows),
            "cities": _facet_rows_to_dicts(city_rows),
            "regions": _facet_rows_to_dicts(region_rows),
            "issue_areas": _facet_rows_to_dicts(issue_rows),
            "entity_types": _facet_rows_to_dicts(type_rows),
            "source_types": _facet_rows_to_dicts(source_type_rows),
        }


def _row_to_entry(row: dict[str, Any]) -> EntryModel:
    """Convert database row to EntryModel."""
    return EntryModel(
        id=row["id"],
        type=row["type"],
        name=row["name"],
        description=row["description"],
        city=row["city"],
        state=row["state"],
        region=row["region"],
        geo_specificity=row["geo_specificity"],
        full_address=row.get("full_address"),
        website=row["website"],
        email=row["email"],
        phone=row["phone"],
        social_media=db.decode_json(row["social_media"]) if row["social_media"] else None,  # type: ignore[arg-type]
        affiliated_org_id=row["affiliated_org_id"],
        active=bool(row["active"]),
        verified=bool(row["verified"]),
        last_verified=date.fromisoformat(row["last_verified"]) if row["last_verified"] else None,
        contact_status=row["contact_status"],
        editorial_notes=row["editorial_notes"],
        priority=row["priority"],
        first_seen=date.fromisoformat(row["first_seen"]),
        last_seen=date.fromisoformat(row["last_seen"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _make_placeholders(values: Sequence[object]) -> str:
    """Create a comma-separated placeholder list for SQLite IN clauses."""
    return ", ".join(["?"] * len(values))


def _facet_rows_to_dicts(rows: list[tuple[Any, Any]]) -> list[dict[str, Any]]:
    """Convert raw facet SQL rows into API-friendly dictionaries."""
    return [{"value": value, "count": int(count)} for value, count in rows]


def _empty_facets() -> dict[str, list[dict[str, Any]]]:
    """Return an empty public-search facet payload."""
    return {
        "states": [],
        "cities": [],
        "regions": [],
        "issue_areas": [],
        "entity_types": [],
        "source_types": [],
    }
