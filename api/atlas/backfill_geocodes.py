"""Backfill map coordinates onto entries that were stored without them.

Atlas's map can only plot an actor it knows the location of. Entries created
before geocoding existed — or any time the gazetteer could not place them — carry
``latitude IS NULL``. This script walks every such entry that at least names a
state, resolves it through the same cheapest-first :func:`geocode_entry` seam the
discovery pipeline uses, and writes the coordinates back so the actor appears on
the map.

It is **idempotent**: it only touches rows that are still unplaced, so re-running
it never re-geocodes a placed actor or clobbers a precise point. By default it
stays fully offline (gazetteer only); ``--use-census`` opts into the remote
rooftop geocoder for entries that carry a full address, trading a network
round-trip for street-level precision.
"""

from __future__ import annotations

import argparse
import asyncio
from typing import TYPE_CHECKING, NamedTuple

from atlas.domains.catalog.geo import geocode_entry
from atlas.models import EntryCRUD, get_db_connection, init_db

if TYPE_CHECKING:
    import aiosqlite


class _UnplacedEntry(NamedTuple):
    """An entry that names a state but carries no coordinates yet."""

    entry_id: str
    city: str | None
    state: str | None
    full_address: str | None


async def _unplaced_candidates(conn: aiosqlite.Connection) -> list[_UnplacedEntry]:
    """Load entries that name a state but have no coordinates yet.

    Parameters
    ----------
    conn : aiosqlite.Connection
        Database connection.

    Returns
    -------
    list[_UnplacedEntry]
        One row per unplaced entry, ordered for stable runs.
    """
    cursor = await conn.execute(
        """
        SELECT id, city, state, full_address
        FROM entries
        WHERE latitude IS NULL AND state IS NOT NULL
        ORDER BY id ASC
        """,
    )
    rows = await cursor.fetchall()
    return [
        _UnplacedEntry(entry_id=row[0], city=row[1], state=row[2], full_address=row[3])
        for row in rows
    ]


async def backfill_geocodes(database_url: str, *, use_census: bool = False) -> int:
    """Place every locatable, currently-unplaced entry on the map.

    Parameters
    ----------
    database_url : str
        Database URL to backfill (e.g. ``sqlite:///atlas.db``).
    use_census : bool, optional
        Whether to permit the remote Census rooftop geocoder for entries with a
        full address. Defaults to False (offline gazetteer only).

    Returns
    -------
    int
        The number of entries that gained coordinates during this run.
    """
    await init_db(database_url)
    conn = await get_db_connection(database_url)
    placed = 0
    try:
        await conn.execute("PRAGMA busy_timeout = 30000")
        for candidate in await _unplaced_candidates(conn):
            located = await geocode_entry(
                candidate.city,
                candidate.state,
                candidate.full_address,
                allow_remote=use_census,
            )
            if located is None:
                continue
            await EntryCRUD.update(
                conn,
                candidate.entry_id,
                latitude=located.latitude,
                longitude=located.longitude,
                geocode_precision=located.precision,
                geocode_source=located.source,
            )
            placed += 1
    finally:
        await conn.close()
    return placed


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill geocodes onto Atlas entries.")
    parser.add_argument(
        "--database-url",
        default="sqlite:///atlas.db",
        help="Database URL to backfill. Defaults to sqlite:///atlas.db.",
    )
    parser.add_argument(
        "--use-census",
        action="store_true",
        help="Permit the remote Census rooftop geocoder for entries with a full address.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    asyncio.run(backfill_geocodes(args.database_url, use_census=args.use_census))


if __name__ == "__main__":
    main()
