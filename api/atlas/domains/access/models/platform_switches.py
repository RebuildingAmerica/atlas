"""Switches the platform operator flips to stop spend or pause sales without a release."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, get_args

from atlas.platform.database import db
from atlas.platform.dates import row_timestamp_string

if TYPE_CHECKING:
    import aiosqlite

SwitchName = Literal["discovery_spend", "checkout"]
SWITCH_NAMES: tuple[SwitchName, ...] = get_args(SwitchName)


@dataclass(frozen=True, slots=True)
class PlatformSwitch:
    """One switch and its last change. ``changed_at`` is ``None`` if it was never flipped."""

    name: SwitchName
    engaged: bool
    reason: str | None
    changed_by: str | None
    changed_at: str | None


class PlatformSwitchCRUD:
    """Read and flip platform switches."""

    @staticmethod
    async def list_all(conn: aiosqlite.Connection) -> list[PlatformSwitch]:
        """Return every switch, including ones never flipped.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.

        Returns
        -------
        list[PlatformSwitch]
            One entry per switch name, in a fixed order.
        """
        cursor = await conn.execute(
            "SELECT name, engaged, reason, changed_by, changed_at FROM platform_switches"
        )
        stored = {str(row[0]): row for row in await cursor.fetchall()}
        switches: list[PlatformSwitch] = []
        for name in SWITCH_NAMES:
            row = stored.get(name)
            if row is None:
                switches.append(PlatformSwitch(name, False, None, None, None))
                continue
            switches.append(
                PlatformSwitch(
                    name=name,
                    engaged=bool(row[1]),
                    reason=str(row[2]),
                    changed_by=str(row[3]),
                    changed_at=row_timestamp_string(row[4]),
                )
            )
        return switches

    @staticmethod
    async def is_engaged(conn: aiosqlite.Connection, name: SwitchName) -> bool:
        """Return whether a switch is engaged.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        name : SwitchName
            The switch.

        Returns
        -------
        bool
            ``True`` while the switch is engaged.
        """
        cursor = await conn.execute("SELECT engaged FROM platform_switches WHERE name = ?", (name,))
        row = await cursor.fetchone()
        return row is not None and bool(row[0])

    @staticmethod
    async def set(
        conn: aiosqlite.Connection,
        name: SwitchName,
        *,
        engaged: bool,
        reason: str,
        changed_by: str,
    ) -> PlatformSwitch:
        """Engage or release a switch and record why.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        name : SwitchName
            The switch.
        engaged : bool
            The new state.
        reason : str
            Why it changed.
        changed_by : str
            The operator who changed it.

        Returns
        -------
        PlatformSwitch
            The switch as stored.
        """
        await conn.execute(
            """
            INSERT INTO platform_switches (name, engaged, reason, changed_by, changed_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                engaged = excluded.engaged,
                reason = excluded.reason,
                changed_by = excluded.changed_by,
                changed_at = excluded.changed_at
            """,
            (name, engaged, reason, changed_by, db.now_iso()),
        )
        await conn.commit()
        switches = await PlatformSwitchCRUD.list_all(conn)
        return next(switch for switch in switches if switch.name == name)
