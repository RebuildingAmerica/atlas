"""Firehose signal persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .model_artifacts import artifact_by_id
from .model_observations import evidence_models_from_observation, primary_observation_for_signal
from .model_records import (
    FirehoseEvidenceModel,
    FirehoseSignalCreate,
    FirehoseSignalModel,
    FirehoseSignalQuery,
    decode_string_list,
    row_dict,
)
from .model_routes import destinations_for_signal

if TYPE_CHECKING:
    import aiosqlite


def _signal_matches(signal: FirehoseSignalModel, query: FirehoseSignalQuery) -> bool:
    evidence_source_classes = [evidence.source_class for evidence in signal.evidence]
    return (
        (not query.places or any(place in query.places for place in signal.places))
        and (not query.issues or any(issue in query.issues for issue in signal.issues))
        and (not query.signal_types or signal.type in query.signal_types)
        and (
            not query.source_classes
            or any(source_class in query.source_classes for source_class in evidence_source_classes)
        )
        and signal.visibility == query.visibility
    )


class FirehoseSignalCRUD:
    """CRUD operations for Firehose signals."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        signal_input: FirehoseSignalCreate,
    ) -> FirehoseSignalModel:
        """Create one signal unless the same civic signal already exists."""
        signal_key = signal_input.signal_key or _default_signal_key(signal_input)
        if signal_key:
            cursor = await conn.execute(
                "SELECT id FROM firehose_signals WHERE org_id = ? AND signal_key = ?",
                (signal_input.org_id, signal_key),
            )
        else:
            cursor = await conn.execute(
                "SELECT id FROM firehose_signals WHERE artifact_id = ? AND signal_type = ?",
                (signal_input.artifact_id, signal_input.signal_type),
            )
        row = await cursor.fetchone()
        if row is not None:
            existing = await FirehoseSignalCRUD.get_by_id(conn, str(row[0]))
            assert existing is not None, "existing signal can be loaded"
            return existing

        signal_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO firehose_signals (
                id, artifact_id, primary_observation_id, signal_key, org_id, coverage_target_id,
                signal_type, title, summary, occurred_at, detected_at, public_realm_basis,
                places_json, issues_json, actors_json, confidence, sensitivity, review_state,
                visibility, route_state, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                signal_id,
                signal_input.artifact_id,
                signal_input.primary_observation_id,
                signal_key,
                signal_input.org_id,
                signal_input.coverage_target_id,
                signal_input.signal_type,
                signal_input.title,
                signal_input.summary,
                signal_input.occurred_at,
                signal_input.detected_at,
                signal_input.public_realm_basis,
                db.encode_json(signal_input.places),
                db.encode_json(signal_input.issues),
                db.encode_json(signal_input.actors),
                signal_input.confidence,
                signal_input.sensitivity,
                signal_input.review_state,
                signal_input.visibility,
                signal_input.route_state,
                now,
                now,
            ),
        )
        await conn.commit()
        created = await FirehoseSignalCRUD.get_by_id(conn, signal_id)
        assert created is not None, "signal was just inserted"
        return created

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        signal_id: str,
    ) -> FirehoseSignalModel | None:
        """Return one stored signal with evidence and destinations."""
        cursor = await conn.execute("SELECT * FROM firehose_signals WHERE id = ?", (signal_id,))
        row = await cursor.fetchone()
        if row is None:
            return None
        data = row_dict(cursor, row)
        artifact_id = data["artifact_id"]
        artifact_evidence: list[FirehoseEvidenceModel] = []
        if artifact_id is not None:
            artifact = await artifact_by_id(conn, str(artifact_id))
            artifact_evidence = [
                FirehoseEvidenceModel(
                    source_url=artifact.source_url,
                    title=artifact.title,
                    publisher=artifact.publisher,
                    published_at=artifact.published_at,
                    captured_at=artifact.fetched_at,
                    passage=artifact.relevant_text,
                    locator=None,
                    content_hash=artifact.content_hash,
                    source_class=artifact.source_class,
                )
            ]
        observation = await primary_observation_for_signal(conn, signal_id)
        observation_evidence = (
            evidence_models_from_observation(observation) if observation is not None else []
        )
        return FirehoseSignalModel(
            id=str(data["id"]),
            artifact_id=str(artifact_id) if artifact_id is not None else None,
            primary_observation_id=data["primary_observation_id"],
            signal_key=data["signal_key"],
            type=str(data["signal_type"]),
            title=str(data["title"]),
            summary=str(data["summary"]),
            occurred_at=data["occurred_at"],
            detected_at=str(data["detected_at"]),
            public_realm_basis=str(data["public_realm_basis"]),
            places=decode_string_list(str(data["places_json"])),
            issues=decode_string_list(str(data["issues_json"])),
            actors_json=str(data["actors_json"]),
            confidence=float(data["confidence"]),
            sensitivity=float(data["sensitivity"]),
            review_state=str(data["review_state"]),
            visibility=str(data["visibility"]),
            route_state=str(data["route_state"]),
            evidence=artifact_evidence or observation_evidence,
            destinations=await destinations_for_signal(conn, signal_id),
        )

    @staticmethod
    async def list_for_query(
        conn: aiosqlite.Connection,
        query: FirehoseSignalQuery,
    ) -> list[FirehoseSignalModel]:
        """Return stored signals matching the Firehose query filters."""
        if query.org_id is None:
            cursor = await conn.execute(
                "SELECT id FROM firehose_signals ORDER BY detected_at DESC, id DESC"
            )
        else:
            cursor = await conn.execute(
                """
                SELECT id FROM firehose_signals
                WHERE org_id = ?
                ORDER BY detected_at DESC, id DESC
                """,
                (query.org_id,),
            )
        rows = await cursor.fetchall()
        signals: list[FirehoseSignalModel] = []
        for row in rows:
            signal = await FirehoseSignalCRUD.get_by_id(conn, str(row[0]))
            if signal is not None and _signal_matches(signal, query):
                signals.append(signal)
            if len(signals) >= query.limit:
                break
        return signals


def _default_signal_key(signal_input: FirehoseSignalCreate) -> str | None:
    """Return a stable signal key for idempotent signal creation."""
    if signal_input.primary_observation_id is not None:
        return f"observation:{signal_input.primary_observation_id}:{signal_input.signal_type}"
    if signal_input.artifact_id is not None:
        return f"artifact:{signal_input.artifact_id}:{signal_input.signal_type}"
    return None
