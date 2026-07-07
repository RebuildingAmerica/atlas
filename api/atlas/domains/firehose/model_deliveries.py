"""Firehose observation delivery outbox persistence."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from atlas.platform.database import db

from .model_records import (
    FirehoseObservationDeliveryModel,
    observation_delivery_from_row,
    row_dict,
)

if TYPE_CHECKING:
    import aiosqlite


def add_seconds(timestamp: str, seconds: int) -> str:
    """Return an ISO timestamp after adding seconds to an existing timestamp."""
    normalized = timestamp.replace("Z", "+00:00")
    value = datetime.fromisoformat(normalized)
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return (value + timedelta(seconds=seconds)).isoformat()


class FirehoseObservationDeliveryCRUD:
    """CRUD operations for the Firehose observation delivery outbox."""

    @staticmethod
    async def enqueue(
        conn: aiosqlite.Connection,
        *,
        observation_id: str,
        next_attempt_at: str,
    ) -> FirehoseObservationDeliveryModel:
        """Create or return the durable delivery for one observation."""
        existing = await FirehoseObservationDeliveryCRUD.get_by_observation_id(
            conn,
            observation_id=observation_id,
        )
        if existing is not None:
            return existing

        delivery_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO firehose_observation_deliveries (
                id, observation_id, status, attempts, claimed_by, claimed_until,
                next_attempt_at, last_error, delivered_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                delivery_id,
                observation_id,
                "pending",
                0,
                None,
                None,
                next_attempt_at,
                None,
                None,
                now,
                now,
            ),
        )
        await conn.commit()
        delivery = await FirehoseObservationDeliveryCRUD.get_by_id(conn, delivery_id)
        assert delivery is not None, "delivery was just inserted"
        return delivery

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        delivery_id: str,
    ) -> FirehoseObservationDeliveryModel | None:
        """Return one observation delivery by id."""
        cursor = await conn.execute(
            "SELECT * FROM firehose_observation_deliveries WHERE id = ?",
            (delivery_id,),
        )
        row = await cursor.fetchone()
        return observation_delivery_from_row(row_dict(cursor, row)) if row is not None else None

    @staticmethod
    async def get_by_observation_id(
        conn: aiosqlite.Connection,
        *,
        observation_id: str,
    ) -> FirehoseObservationDeliveryModel | None:
        """Return the delivery for one observation, if present."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_observation_deliveries
            WHERE observation_id = ?
            """,
            (observation_id,),
        )
        row = await cursor.fetchone()
        return observation_delivery_from_row(row_dict(cursor, row)) if row is not None else None

    @staticmethod
    async def list_by_observation_id(
        conn: aiosqlite.Connection,
        *,
        observation_id: str,
    ) -> list[FirehoseObservationDeliveryModel]:
        """Return every delivery row for one observation."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_observation_deliveries
            WHERE observation_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (observation_id,),
        )
        rows = await cursor.fetchall()
        return [observation_delivery_from_row(row_dict(cursor, row)) for row in rows]

    @staticmethod
    async def claim_due(
        conn: aiosqlite.Connection,
        *,
        worker_id: str,
        now: str,
        lease_seconds: int,
        limit: int,
    ) -> list[FirehoseObservationDeliveryModel]:
        """Claim due deliveries for one worker lease."""
        cursor = await conn.execute(
            """
            SELECT id
            FROM firehose_observation_deliveries
            WHERE (
                status IN ('pending', 'failed')
                AND next_attempt_at <= ?
            ) OR (
                status = 'claimed'
                AND claimed_until <= ?
            )
            ORDER BY next_attempt_at ASC, created_at ASC, id ASC
            LIMIT ?
            """,
            (now, now, limit),
        )
        rows = await cursor.fetchall()
        claimed: list[FirehoseObservationDeliveryModel] = []
        lease_until = add_seconds(now, lease_seconds)
        for row in rows:
            delivery_id = str(row[0])
            update = await conn.execute(
                """
                UPDATE firehose_observation_deliveries
                SET status = 'claimed',
                    attempts = attempts + 1,
                    claimed_by = ?,
                    claimed_until = ?,
                    updated_at = ?
                WHERE id = ?
                  AND (
                    (
                        status IN ('pending', 'failed')
                        AND next_attempt_at <= ?
                    ) OR (
                        status = 'claimed'
                        AND claimed_until <= ?
                    )
                  )
                """,
                (worker_id, lease_until, now, delivery_id, now, now),
            )
            if update.rowcount <= 0:
                continue
            delivery = await FirehoseObservationDeliveryCRUD.get_by_id(conn, delivery_id)
            assert delivery is not None, "claimed delivery should still exist"
            claimed.append(delivery)
        await conn.commit()
        return claimed

    @staticmethod
    async def mark_delivered(
        conn: aiosqlite.Connection,
        *,
        delivery_id: str,
        delivered_at: str,
    ) -> None:
        """Mark one claimed delivery as delivered."""
        await conn.execute(
            """
            UPDATE firehose_observation_deliveries
            SET status = 'delivered',
                claimed_by = NULL,
                claimed_until = NULL,
                last_error = NULL,
                delivered_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (delivered_at, delivered_at, delivery_id),
        )
        await conn.commit()

    @staticmethod
    async def mark_failed(
        conn: aiosqlite.Connection,
        *,
        delivery_id: str,
        failed_at: str,
        last_error: str,
        retry_delay_seconds: int,
    ) -> None:
        """Mark one claimed delivery as failed and due for a later retry."""
        await conn.execute(
            """
            UPDATE firehose_observation_deliveries
            SET status = 'failed',
                claimed_by = NULL,
                claimed_until = NULL,
                next_attempt_at = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (add_seconds(failed_at, retry_delay_seconds), last_error[:500], failed_at, delivery_id),
        )
        await conn.commit()
