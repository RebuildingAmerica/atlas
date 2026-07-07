"""Firehose route persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from atlas.platform.database import db

from .model_records import (
    FirehoseDestinationModel,
    FirehoseRouteCreate,
    FirehoseRouteDestinationType,
    FirehoseRouteModel,
    FirehoseRouteState,
    route_from_row,
    row_dict,
)

if TYPE_CHECKING:
    import aiosqlite


async def destinations_for_signal(
    conn: aiosqlite.Connection,
    signal_id: str,
) -> list[FirehoseDestinationModel]:
    """Return destinations for a signal."""
    cursor = await conn.execute(
        """
        SELECT destination_type, destination_id, state
        FROM firehose_routes
        WHERE signal_id = ?
        ORDER BY routed_at ASC, id ASC
        """,
        (signal_id,),
    )
    rows = await cursor.fetchall()
    return [
        FirehoseDestinationModel(
            type=cast("FirehoseRouteDestinationType", row[0]),
            id=str(row[1]) if row[1] is not None else None,
            state=cast("FirehoseRouteState", row[2]),
        )
        for row in rows
    ]


class FirehoseRouteCRUD:
    """CRUD operations for Firehose signal routes."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        route_input: FirehoseRouteCreate,
    ) -> FirehoseRouteModel:
        """Create or return one signal route."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_routes
            WHERE signal_id = ? AND destination_type = ?
              AND COALESCE(destination_id, '') = COALESCE(?, '')
            """,
            (route_input.signal_id, route_input.destination_type, route_input.destination_id),
        )
        row = await cursor.fetchone()
        if row is not None:
            return route_from_row(row_dict(cursor, row))

        route_id = db.generate_uuid()
        routed_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO firehose_routes (
                id, signal_id, destination_type, destination_id, state, route_reason, routed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                route_id,
                route_input.signal_id,
                route_input.destination_type,
                route_input.destination_id,
                route_input.state,
                route_input.route_reason,
                routed_at,
            ),
        )
        await conn.commit()
        route = await FirehoseRouteCRUD.get_by_id(conn, route_id)
        assert route is not None, "route was just inserted"
        return route

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        route_id: str,
    ) -> FirehoseRouteModel | None:
        """Return one route by id."""
        cursor = await conn.execute("SELECT * FROM firehose_routes WHERE id = ?", (route_id,))
        row = await cursor.fetchone()
        return route_from_row(row_dict(cursor, row)) if row is not None else None
