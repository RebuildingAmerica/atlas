"""
Entry model and CRUD operations.

Entries are the core entity in The Atlas: people, organizations, initiatives,
campaigns, and events tied to a place and set of issues.
"""

from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry_model import (
    EntryModel,
    _row_to_entry,
    actor_quality,
    trust_tier,
)
from atlas.domains.catalog.models.entry_search import EntrySearchMixin
from atlas.platform.database import db

if TYPE_CHECKING:
    import builtins

    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["EntryCRUD", "EntryModel", "_row_to_entry", "actor_quality", "trust_tier"]


class EntryCRUD(EntrySearchMixin):
    """CRUD operations for entries."""

    @staticmethod
    def generate_slug(name: str, entry_id: str) -> str:
        """Generate a URL slug from name + short hash of entry ID.

        Unicode characters are transliterated to ASCII, special characters
        stripped, and a 4-character SHA-256 hash of the entry ID appended
        for collision safety.

        Parameters
        ----------
        name : str
            The entry's display name (e.g., "Jane Doe").
        entry_id : str
            The entry UUID used to derive the short hash suffix.

        Returns
        -------
        str
            A slug like ``jane-doe-a3f2``.
        """
        normalized = unicodedata.normalize("NFKD", name)
        ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
        slug_name = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
        slug_name = re.sub(r"-{2,}", "-", slug_name)
        short_hash = hashlib.sha256(entry_id.encode()).hexdigest()[:4]
        return f"{slug_name}-{short_hash}"

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
        latitude: float | None = None,
        longitude: float | None = None,
        geocode_precision: str | None = None,
        geocode_source: str | None = None,
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
        active: bool = True,
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
        latitude : float | None, optional
            Geocoded latitude placing the actor on the map. Default is None.
        longitude : float | None, optional
            Geocoded longitude placing the actor on the map. Default is None.
        geocode_precision : str | None, optional
            How confidently the location is known (rooftop, city, state, none).
            Default is None.
        geocode_source : str | None, optional
            Who resolved the location (gazetteer, census, manual). Default is None.
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
        active : bool, optional
            Whether the entry is publicly visible on creation. Default is True.
            The trust gate passes False to hold a discovered record for review.

        Returns
        -------
        str
            The created entry ID.
        """
        entry_id = db.generate_uuid()
        slug = EntryCRUD.generate_slug(name, entry_id)
        now = db.now_iso()
        today = datetime.now(tz=UTC).date()
        first_seen_val = first_seen or today
        last_seen_val = last_seen or today

        await conn.execute(
            """
            INSERT INTO entries (
                id, type, name, description, city, state, region,
                geo_specificity, latitude, longitude, geocode_precision, geocode_source,
                full_address, website, email, phone, social_media,
                affiliated_org_id, active, contact_status, editorial_notes, priority,
                first_seen, last_seen, created_at, updated_at, slug
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                latitude,
                longitude,
                geocode_precision,
                geocode_source,
                full_address,
                website,
                email,
                phone,
                db.encode_json(social_media) if social_media else None,
                affiliated_org_id,
                1 if active else 0,
                contact_status,
                editorial_notes,
                priority,
                first_seen_val.isoformat(),
                last_seen_val.isoformat(),
                now,
                now,
                slug,
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
    async def get_by_slug(conn: aiosqlite.Connection, slug: str) -> EntryModel | None:
        """Look up an active entry by its URL slug.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        slug : str
            The slug to look up (e.g., ``jane-doe-a3f2``).

        Returns
        -------
        EntryModel | None
            The matching entry, or None if no active entry has this slug.
        """
        cursor = await conn.execute(
            "SELECT * FROM entries WHERE slug = ? AND active = 1",
            (slug,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return _row_to_entry(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def resolve_slug(conn: aiosqlite.Connection, slug: str) -> dict[str, Any] | None:
        """Resolve a slug to an entry, falling back to slug_aliases.

        Tries the primary ``slug`` column first. If no match, checks
        ``slug_aliases`` for a renamed vanity slug and returns the
        canonical slug so callers can issue a redirect.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        slug : str
            The slug to resolve (may be current or an old alias).

        Returns
        -------
        dict[str, Any] | None
            Dict with keys ``entry`` (EntryModel), ``canonical_slug`` (str),
            and ``is_alias`` (bool). None if the slug is not found anywhere.
        """
        entry = await EntryCRUD.get_by_slug(conn, slug)
        if entry is not None:
            return {"entry": entry, "canonical_slug": entry.slug, "is_alias": False}

        cursor = await conn.execute(
            "SELECT entry_id FROM slug_aliases WHERE old_slug = ?",
            (slug,),
        )
        alias_row = await cursor.fetchone()
        if alias_row is None:
            return None

        entry_id = alias_row[0]
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        if entry is None:
            return None
        return {"entry": entry, "canonical_slug": entry.slug, "is_alias": True}

    @staticmethod
    async def is_publicly_visible(conn: aiosqlite.Connection, entry_id: str) -> bool:
        """Return whether an entry can be exposed through public catalog endpoints."""
        cursor = await conn.execute(
            """
            SELECT e.active, ro.visibility
            FROM entries e
            LEFT JOIN resource_ownership ro
              ON ro.resource_id = e.id
             AND ro.resource_type = 'entry'
            WHERE e.id = ?
            """,
            (entry_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return False

        active, visibility = row
        return bool(active) and visibility != "private"

    @staticmethod
    async def set_vanity_slug(conn: aiosqlite.Connection, entry_id: str, new_slug: str) -> bool:
        """Replace an entry's slug with a vanity slug.

        The previous slug is saved to ``slug_aliases`` so old URLs
        continue to resolve (via 301 redirect).

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            The entry to update.
        new_slug : str
            The vanity slug to set.

        Returns
        -------
        bool
            True if the slug was updated, False if the entry was not found.
        """
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        if entry is None:
            return False

        old_slug = entry.slug
        if old_slug == new_slug:
            return True

        if old_slug is not None:
            await conn.execute(
                "INSERT OR IGNORE INTO slug_aliases (old_slug, entry_id) VALUES (?, ?)",
                (old_slug, entry_id),
            )

        await conn.execute(
            "UPDATE entries SET slug = ?, updated_at = ? WHERE id = ?",
            (new_slug, db.now_iso(), entry_id),
        )
        await conn.commit()
        return True

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
            "latitude",
            "longitude",
            "geocode_precision",
            "geocode_source",
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
            "photo_url",
            "custom_bio",
            "claim_status",
            "claimed_by_user_id",
            "claim_verified_at",
            "last_confirmed_at",
            "suppressed_source_ids",
            "preferred_contact_channel",
        }

        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        fields_to_update["updated_at"] = db.now_iso()

        # Handle JSON encoding for social_media
        if fields_to_update.get("social_media"):
            fields_to_update["social_media"] = db.encode_json(fields_to_update["social_media"])
        if "suppressed_source_ids" in fields_to_update:
            value = fields_to_update["suppressed_source_ids"]
            if value:
                if not isinstance(value, list | tuple | set):
                    msg = "suppressed_source_ids must be an iterable of source IDs"
                    raise TypeError(msg)
                fields_to_update["suppressed_source_ids"] = db.encode_json(list(value))
            else:
                fields_to_update["suppressed_source_ids"] = None
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
