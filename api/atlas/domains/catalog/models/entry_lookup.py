"""Entry lookup and slug management helpers."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

from .entry_model import EntryModel, _row_to_entry

if TYPE_CHECKING:
    import aiosqlite


class EntryLookupMixin:
    """Lookup, creation, and slug resolution helpers for entries."""

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
        slug = EntryLookupMixin.generate_slug(name, entry_id)
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
                active,
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
            "SELECT * FROM entries WHERE slug = ? AND active = TRUE",
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
        entry = await EntryLookupMixin.get_by_slug(conn, slug)
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
        entry = await EntryLookupMixin.get_by_id(conn, entry_id)
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
        entry = await EntryLookupMixin.get_by_id(conn, entry_id)
        if entry is None:
            return False

        old_slug = entry.slug
        if old_slug == new_slug:
            return True

        if old_slug is not None:
            await conn.execute(
                """
                INSERT INTO slug_aliases (old_slug, entry_id)
                VALUES (?, ?)
                ON CONFLICT(old_slug) DO NOTHING
                """,
                (old_slug, entry_id),
            )

        await conn.execute(
            "UPDATE entries SET slug = ?, updated_at = ? WHERE id = ?",
            (new_slug, db.now_iso(), entry_id),
        )
        await conn.commit()
        return True
