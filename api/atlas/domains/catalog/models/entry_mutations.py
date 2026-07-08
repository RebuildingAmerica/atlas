"""Entry mutation helpers."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite


class EntryMutationMixin:
    """Update and delete helpers for entries."""

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
