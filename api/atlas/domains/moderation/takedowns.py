"""Profiles an editor took down, and the check that keeps them down.

A takedown hides a published profile, usually because the person asked to be
removed. Showing it again by accident, through an approval, a registry match
or the next discovery run, would break the promise made to that person, so
every path that publishes an entry asks :meth:`EntryTakedownCRUD.is_taken_down`
first. Restoring a profile is a separate, recorded decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db
from atlas.platform.dates import row_timestamp_string

if TYPE_CHECKING:
    import aiosqlite


def not_taken_down(entry_column: str) -> str:
    """Return a SQL condition that is true unless a takedown stands for the entry.

    Every read that shows an entry to people outside the editorial tools, such
    as a follower's feed or a workspace's watch digest, adds this condition so
    a profile taken down at someone's request disappears everywhere at once.

    Parameters
    ----------
    entry_column : str
        The column holding the entry id in the surrounding query, such as
        ``e.id``. It is SQL, so pass only a fixed identifier, never input.

    Returns
    -------
    str
        A ``NOT EXISTS`` condition to add with ``AND``.
    """
    return (
        "NOT EXISTS (SELECT 1 FROM entry_takedowns standing"
        f" WHERE standing.entry_id = {entry_column} AND standing.restored_at IS NULL)"
    )


_COLUMNS = (
    "id, entry_id, entry_name, entry_slug, entry_type, reason, was_active, "
    "taken_down_by, taken_down_at, restored_by, restored_at"
)


class TakedownConflictError(Exception):
    """The profile is already down, or the takedown was already lifted."""


@dataclass(frozen=True, slots=True)
class EntryTakedown:
    """One takedown, standing or lifted."""

    id: str
    entry_id: str
    entry_name: str
    entry_slug: str | None
    entry_type: str
    reason: str
    was_active: bool
    taken_down_by: str
    taken_down_at: str
    restored_by: str | None
    restored_at: str | None


@dataclass(frozen=True, slots=True)
class TakedownTarget:
    """The profile a takedown is about, whether or not it is published."""

    id: str
    name: str
    slug: str | None
    type: str
    active: bool


def _row_to_takedown(row: Any) -> EntryTakedown:
    return EntryTakedown(
        id=str(row[0]),
        entry_id=str(row[1]),
        entry_name=str(row[2]),
        entry_slug=str(row[3]) if row[3] is not None else None,
        entry_type=str(row[4]),
        reason=str(row[5]),
        was_active=bool(row[6]),
        taken_down_by=str(row[7]),
        taken_down_at=str(row_timestamp_string(row[8])),
        restored_by=str(row[9]) if row[9] is not None else None,
        restored_at=row_timestamp_string(row[10]),
    )


class EntryTakedownCRUD:
    """Take profiles down, lift takedowns, and answer whether one stands."""

    @staticmethod
    async def find_target(conn: aiosqlite.Connection, slug: str) -> TakedownTarget | None:
        """Return the profile with this slug, published or not.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        slug : str
            The profile's slug, as in its public address.

        Returns
        -------
        TakedownTarget | None
            The profile, or ``None`` when no entry has this slug.
        """
        cursor = await conn.execute(
            "SELECT id, name, slug, type, active FROM entries WHERE slug = ?",
            (slug,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return TakedownTarget(
            id=str(row[0]),
            name=str(row[1]),
            slug=str(row[2]) if row[2] is not None else None,
            type=str(row[3]),
            active=bool(row[4]),
        )

    @staticmethod
    async def is_taken_down(conn: aiosqlite.Connection, entry_id: str) -> bool:
        """Return whether a takedown stands for this entry.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            The entry to check.

        Returns
        -------
        bool
            ``True`` while the entry must stay hidden.
        """
        cursor = await conn.execute(
            "SELECT 1 FROM entry_takedowns WHERE entry_id = ? AND restored_at IS NULL",
            (entry_id,),
        )
        return await cursor.fetchone() is not None

    @staticmethod
    async def take_down(
        conn: aiosqlite.Connection,
        target: TakedownTarget,
        *,
        reason: str,
        taken_down_by: str,
    ) -> EntryTakedown:
        """Hide a profile and record why.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        target : TakedownTarget
            The profile to hide.
        reason : str
            Why it comes down, kept with the record for whoever restores it.
        taken_down_by : str
            The editor taking it down.

        Returns
        -------
        EntryTakedown
            The standing takedown.

        Raises
        ------
        TakedownConflictError
            When a takedown already stands for the profile, including one made
            a moment earlier by a concurrent request.
        """
        takedown_id = db.generate_uuid()
        # The partial unique index allows one standing takedown per entry, so a
        # second, even a concurrent one, inserts nothing rather than failing.
        inserted = await conn.execute(
            f"""
            INSERT INTO entry_takedowns ({_COLUMNS})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """,
            (
                takedown_id,
                target.id,
                target.name,
                target.slug,
                target.type,
                reason,
                target.active,
                taken_down_by,
                db.now_iso(),
                None,
                None,
            ),
        )
        if inserted.rowcount != 1:
            msg = "This profile is already taken down."
            raise TakedownConflictError(msg)
        await conn.execute("UPDATE entries SET active = FALSE WHERE id = ?", (target.id,))
        await conn.commit()
        takedown = await EntryTakedownCRUD.get_by_id(conn, takedown_id)
        assert takedown is not None, "Takedown must exist immediately after creation"
        return takedown

    @staticmethod
    async def restore(
        conn: aiosqlite.Connection, takedown_id: str, *, restored_by: str
    ) -> EntryTakedown | None:
        """Lift a takedown and put the profile back the way it was.

        A profile that was published before it came down is published again; one
        that was still waiting for review goes back to waiting.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        takedown_id : str
            The takedown to lift.
        restored_by : str
            The editor lifting it.

        Returns
        -------
        EntryTakedown | None
            The lifted takedown, or ``None`` when there is no such takedown.

        Raises
        ------
        TakedownConflictError
            When the takedown was already lifted.
        """
        takedown = await EntryTakedownCRUD.get_by_id(conn, takedown_id)
        if takedown is None:
            return None
        if takedown.restored_at is not None:
            msg = "This takedown was already lifted."
            raise TakedownConflictError(msg)
        await conn.execute(
            "UPDATE entry_takedowns SET restored_by = ?, restored_at = ? WHERE id = ?",
            (restored_by, db.now_iso(), takedown_id),
        )
        await conn.execute(
            "UPDATE entries SET active = ? WHERE id = ?",
            (takedown.was_active, takedown.entry_id),
        )
        await conn.commit()
        return await EntryTakedownCRUD.get_by_id(conn, takedown_id)

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, takedown_id: str) -> EntryTakedown | None:
        """Return one takedown.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        takedown_id : str
            The takedown's id.

        Returns
        -------
        EntryTakedown | None
            The takedown, or ``None``.
        """
        cursor = await conn.execute(
            f"SELECT {_COLUMNS} FROM entry_takedowns WHERE id = ?", (takedown_id,)
        )
        row = await cursor.fetchone()
        return _row_to_takedown(row) if row is not None else None

    @staticmethod
    async def list_standing(conn: aiosqlite.Connection, *, limit: int) -> list[EntryTakedown]:
        """Return the takedowns that stand, newest first.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        limit : int
            Maximum number to return.

        Returns
        -------
        list[EntryTakedown]
            Standing takedowns.
        """
        cursor = await conn.execute(
            f"""
            SELECT {_COLUMNS} FROM entry_takedowns
            WHERE restored_at IS NULL
            ORDER BY taken_down_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [_row_to_takedown(row) for row in await cursor.fetchall()]
