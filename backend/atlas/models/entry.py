"""
Entry model and CRUD operations.

Entries are the core entity in The Atlas: people, organizations, initiatives,
campaigns, and events tied to a place and set of issues.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

import aiosqlite

from atlas.models.database import db

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
                geo_specificity, website, email, phone, social_media,
                affiliated_org_id, contact_status, editorial_notes, priority,
                first_seen, last_seen, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ) -> list[EntryModel]:
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
        params: list[Any] = []

        if active_only:
            query += " AND active = 1"
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
    ) -> list[EntryModel]:  # noqa: A003
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
        cursor = await conn.execute(
            """
            SELECT e.* FROM entries e
            JOIN entries_fts fts ON e.rowid = fts.rowid
            WHERE entries_fts MATCH ?
            LIMIT ?
            """,
            (query, limit),
        )
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
    ) -> list[EntryModel]:  # noqa: A003
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
            WHERE eia.issue_area = ? AND e.active = 1
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
    ) -> tuple[EntryModel | None, list[dict[str, Any]]]:  # noqa: A003
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
        website=row["website"],
        email=row["email"],
        phone=row["phone"],
        social_media=db.decode_json(row["social_media"]) if row["social_media"] else None,
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
