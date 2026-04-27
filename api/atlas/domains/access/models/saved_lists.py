"""Saved profile lists — signed-in users can pin entries into named collections."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["SavedListCRUD", "SavedListItemModel", "SavedListModel"]


@dataclass
class SavedListModel:
    """Saved list resource."""

    id: str
    user_id: str
    name: str
    description: str | None
    created_at: str
    updated_at: str


@dataclass
class SavedListItemModel:
    """Membership of an entry inside a saved list."""

    list_id: str
    entry_id: str
    note: str | None
    added_at: str


class SavedListCRUD:
    """CRUD operations for saved lists and their items."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        *,
        user_id: str,
        name: str,
        description: str | None = None,
    ) -> SavedListModel:
        """Create a new saved list."""
        list_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO saved_lists (id, user_id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (list_id, user_id, name, description, now, now),
        )
        await conn.commit()
        return SavedListModel(
            id=list_id,
            user_id=user_id,
            name=name,
            description=description,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, list_id: str) -> SavedListModel | None:
        """Fetch a list by id."""
        cursor = await conn.execute(
            "SELECT id, user_id, name, description, created_at, updated_at "
            "FROM saved_lists WHERE id = ?",
            (list_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return SavedListModel(
            id=row[0],
            user_id=row[1],
            name=row[2],
            description=row[3],
            created_at=row[4],
            updated_at=row[5],
        )

    @staticmethod
    async def list_for_user(conn: aiosqlite.Connection, user_id: str) -> list[SavedListModel]:
        """Return every list owned by the user, newest first."""
        cursor = await conn.execute(
            """
            SELECT id, user_id, name, description, created_at, updated_at
            FROM saved_lists WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [
            SavedListModel(
                id=row[0],
                user_id=row[1],
                name=row[2],
                description=row[3],
                created_at=row[4],
                updated_at=row[5],
            )
            for row in rows
        ]

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        list_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> SavedListModel | None:
        """Update list name or description. Returns the updated record or None."""
        fields: dict[str, Any] = {}
        if name is not None:
            fields["name"] = name
        if description is not None:
            fields["description"] = description
        if not fields:
            return await SavedListCRUD.get_by_id(conn, list_id)
        fields["updated_at"] = db.now_iso()
        set_clause = ", ".join(f"{key} = ?" for key in fields)
        cursor = await conn.execute(
            f"UPDATE saved_lists SET {set_clause} WHERE id = ?",
            [*fields.values(), list_id],
        )
        await conn.commit()
        if cursor.rowcount == 0:
            return None
        return await SavedListCRUD.get_by_id(conn, list_id)

    @staticmethod
    async def delete(conn: aiosqlite.Connection, list_id: str) -> bool:
        """Delete a list and (via FK cascade) its members."""
        cursor = await conn.execute("DELETE FROM saved_lists WHERE id = ?", (list_id,))
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def add_item(
        conn: aiosqlite.Connection,
        *,
        list_id: str,
        entry_id: str,
        note: str | None = None,
    ) -> SavedListItemModel:
        """Add an entry to a list (idempotent — replaces note if already present)."""
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO saved_list_items (list_id, entry_id, note, added_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(list_id, entry_id) DO UPDATE SET note = excluded.note
            """,
            (list_id, entry_id, note, now),
        )
        await conn.execute(
            "UPDATE saved_lists SET updated_at = ? WHERE id = ?",
            (now, list_id),
        )
        await conn.commit()
        return SavedListItemModel(
            list_id=list_id,
            entry_id=entry_id,
            note=note,
            added_at=now,
        )

    @staticmethod
    async def remove_item(conn: aiosqlite.Connection, *, list_id: str, entry_id: str) -> bool:
        """Remove an entry from a list."""
        cursor = await conn.execute(
            "DELETE FROM saved_list_items WHERE list_id = ? AND entry_id = ?",
            (list_id, entry_id),
        )
        if cursor.rowcount > 0:
            await conn.execute(
                "UPDATE saved_lists SET updated_at = ? WHERE id = ?",
                (db.now_iso(), list_id),
            )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def list_items(conn: aiosqlite.Connection, list_id: str) -> list[SavedListItemModel]:
        """Return all items in a list (newest first)."""
        cursor = await conn.execute(
            """
            SELECT list_id, entry_id, note, added_at
            FROM saved_list_items WHERE list_id = ?
            ORDER BY added_at DESC
            """,
            (list_id,),
        )
        rows = await cursor.fetchall()
        return [
            SavedListItemModel(
                list_id=row[0],
                entry_id=row[1],
                note=row[2],
                added_at=row[3],
            )
            for row in rows
        ]

    @staticmethod
    async def count_items(conn: aiosqlite.Connection, list_id: str) -> int:
        """Return the number of items in a list."""
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM saved_list_items WHERE list_id = ?",
            (list_id,),
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0

    @staticmethod
    async def lists_containing_entry(
        conn: aiosqlite.Connection, *, user_id: str, entry_id: str
    ) -> list[str]:
        """Return ids of all of the user's lists that contain ``entry_id``."""
        cursor = await conn.execute(
            """
            SELECT sli.list_id FROM saved_list_items sli
            JOIN saved_lists sl ON sl.id = sli.list_id
            WHERE sl.user_id = ? AND sli.entry_id = ?
            """,
            (user_id, entry_id),
        )
        rows = await cursor.fetchall()
        return [row[0] for row in rows]
