"""Profile follow subscriptions — users follow profiles to see new sources."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["FollowCRUD", "ProfileFollowModel"]


@dataclass
class ProfileFollowModel:
    """A user's subscription to one profile."""

    user_id: str
    entry_id: str
    subscribed_to: str
    created_at: str


class FollowCRUD:
    """CRUD for profile follows."""

    @staticmethod
    async def follow(
        conn: aiosqlite.Connection,
        *,
        user_id: str,
        entry_id: str,
        subscribed_to: str = "sources",
    ) -> ProfileFollowModel:
        """Subscribe the user to a profile (idempotent)."""
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO profile_follows (user_id, entry_id, subscribed_to, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, entry_id) DO UPDATE SET subscribed_to = excluded.subscribed_to
            """,
            (user_id, entry_id, subscribed_to, now),
        )
        await conn.commit()
        return ProfileFollowModel(
            user_id=user_id,
            entry_id=entry_id,
            subscribed_to=subscribed_to,
            created_at=now,
        )

    @staticmethod
    async def unfollow(conn: aiosqlite.Connection, *, user_id: str, entry_id: str) -> bool:
        """Remove a follow subscription. Returns True when a row was deleted."""
        cursor = await conn.execute(
            "DELETE FROM profile_follows WHERE user_id = ? AND entry_id = ?",
            (user_id, entry_id),
        )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def is_following(
        conn: aiosqlite.Connection, *, user_id: str, entry_id: str
    ) -> ProfileFollowModel | None:
        """Return the follow record if it exists, else None."""
        cursor = await conn.execute(
            """
            SELECT user_id, entry_id, subscribed_to, created_at
            FROM profile_follows WHERE user_id = ? AND entry_id = ?
            """,
            (user_id, entry_id),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return ProfileFollowModel(
            user_id=row[0],
            entry_id=row[1],
            subscribed_to=row[2],
            created_at=row[3],
        )

    @staticmethod
    async def list_for_user(conn: aiosqlite.Connection, user_id: str) -> list[ProfileFollowModel]:
        """Return every follow row for a user."""
        cursor = await conn.execute(
            """
            SELECT user_id, entry_id, subscribed_to, created_at
            FROM profile_follows WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [
            ProfileFollowModel(
                user_id=row[0],
                entry_id=row[1],
                subscribed_to=row[2],
                created_at=row[3],
            )
            for row in rows
        ]

    @staticmethod
    async def feed_updates(
        conn: aiosqlite.Connection, user_id: str, *, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Return recent source ingest events for entries the user follows.

        Each event is shaped as ``{"entry_id", "entry_name", "entry_slug",
        "entry_type", "source_id", "source_url", "source_title",
        "source_publication", "ingested_at"}``.
        """
        cursor = await conn.execute(
            """
            SELECT
                e.id AS entry_id,
                e.name AS entry_name,
                e.slug AS entry_slug,
                e.type AS entry_type,
                s.id AS source_id,
                s.url AS source_url,
                s.title AS source_title,
                s.publication AS source_publication,
                s.ingested_at AS ingested_at
            FROM profile_follows pf
            JOIN entry_sources es ON es.entry_id = pf.entry_id
            JOIN sources s ON s.id = es.source_id
            JOIN entries e ON e.id = pf.entry_id
            WHERE pf.user_id = ?
            ORDER BY s.ingested_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        )
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row, strict=False)) for row in rows]
