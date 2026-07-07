"""Firehose observation persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .model_records import (
    FirehoseEvidenceModel,
    FirehoseObservationCreate,
    FirehoseObservationModel,
    observation_from_row,
    row_dict,
)

if TYPE_CHECKING:
    import aiosqlite


class FirehoseObservationCRUD:
    """CRUD operations for the platform-wide Firehose observation log."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        observation_input: FirehoseObservationCreate,
    ) -> FirehoseObservationModel:
        """Create one observation unless the producer already delivered it."""
        existing = await FirehoseObservationCRUD.get_by_producer_key(
            conn,
            producer=observation_input.producer,
            dedupe_key=observation_input.dedupe_key,
        )
        if existing is not None:
            return existing

        observation_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO firehose_observations (
                id, producer, observation_type, subject_type, subject_id, org_id,
                coverage_target_id, places_json, issues_json, source_class, occurred_at,
                observed_at, dedupe_key, public_realm_basis, confidence, sensitivity,
                payload_json, evidence_json, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                observation_id,
                observation_input.producer,
                observation_input.observation_type,
                observation_input.subject_type,
                observation_input.subject_id,
                observation_input.org_id,
                observation_input.coverage_target_id,
                db.encode_json(observation_input.places),
                db.encode_json(observation_input.issues),
                observation_input.source_class,
                observation_input.occurred_at,
                observation_input.observed_at,
                observation_input.dedupe_key,
                observation_input.public_realm_basis,
                observation_input.confidence,
                observation_input.sensitivity,
                db.encode_json(observation_input.payload),
                db.encode_json(observation_input.evidence),
                "observed",
                now,
                now,
            ),
        )
        await conn.commit()
        created = await FirehoseObservationCRUD.get_by_id(conn, observation_id)
        assert created is not None, "observation was just inserted"
        return created

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        observation_id: str,
    ) -> FirehoseObservationModel | None:
        """Return one observation by id."""
        cursor = await conn.execute(
            "SELECT * FROM firehose_observations WHERE id = ?",
            (observation_id,),
        )
        row = await cursor.fetchone()
        return observation_from_row(row_dict(cursor, row)) if row is not None else None

    @staticmethod
    async def get_by_producer_key(
        conn: aiosqlite.Connection,
        *,
        producer: str,
        dedupe_key: str,
    ) -> FirehoseObservationModel | None:
        """Return one observation by its producer idempotency key."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_observations
            WHERE producer = ? AND dedupe_key = ?
            """,
            (producer, dedupe_key),
        )
        row = await cursor.fetchone()
        return observation_from_row(row_dict(cursor, row)) if row is not None else None

    @staticmethod
    async def mark_signals_created(
        conn: aiosqlite.Connection,
        observation_id: str,
    ) -> None:
        """Mark an observation after at least one signal exists for it."""
        await conn.execute(
            """
            UPDATE firehose_observations
            SET status = 'signals_created', updated_at = ?
            WHERE id = ?
            """,
            (db.now_iso(), observation_id),
        )
        await conn.commit()


async def link_signal_observation(
    conn: aiosqlite.Connection,
    *,
    signal_id: str,
    observation_id: str,
    role: str,
) -> bool:
    """Attach a signal to the observation that produced or supports it."""
    cursor = await conn.execute(
        """
        SELECT 1 FROM firehose_signal_observations
        WHERE signal_id = ? AND observation_id = ?
        """,
        (signal_id, observation_id),
    )
    if await cursor.fetchone() is not None:
        return False

    await conn.execute(
        """
        INSERT INTO firehose_signal_observations (
            signal_id, observation_id, role, created_at
        ) VALUES (?, ?, ?, ?)
        """,
        (signal_id, observation_id, role, db.now_iso()),
    )
    await conn.commit()
    return True


async def primary_observation_for_signal(
    conn: aiosqlite.Connection,
    signal_id: str,
) -> FirehoseObservationModel | None:
    """Return the primary observation for one signal, when present."""
    cursor = await conn.execute(
        """
        SELECT o.*
        FROM firehose_observations o
        JOIN firehose_signal_observations so ON so.observation_id = o.id
        WHERE so.signal_id = ? AND so.role = 'primary'
        ORDER BY so.created_at ASC
        LIMIT 1
        """,
        (signal_id,),
    )
    row = await cursor.fetchone()
    return observation_from_row(row_dict(cursor, row)) if row is not None else None


def evidence_models_from_observation(
    observation: FirehoseObservationModel,
) -> list[FirehoseEvidenceModel]:
    """Return source evidence models stored on an observation."""
    decoded = db.decode_json(observation.evidence_json)
    if not isinstance(decoded, list):
        return []

    evidence: list[FirehoseEvidenceModel] = []
    for item in decoded:
        if not isinstance(item, dict):
            continue
        evidence.append(
            FirehoseEvidenceModel(
                source_url=str(item.get("source_url") or ""),
                title=str(item["title"]) if item.get("title") is not None else None,
                publisher=str(item["publisher"]) if item.get("publisher") is not None else None,
                published_at=(
                    str(item["published_at"]) if item.get("published_at") is not None else None
                ),
                captured_at=str(item.get("captured_at") or observation.observed_at),
                passage=str(item.get("passage") or ""),
                locator=str(item["locator"]) if item.get("locator") is not None else None,
                content_hash=str(item.get("content_hash") or ""),
                source_class=str(item.get("source_class") or observation.source_class or ""),
            )
        )
    return evidence
