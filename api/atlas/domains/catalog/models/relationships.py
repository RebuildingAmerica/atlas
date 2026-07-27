"""Sourced relationship edges and stable actor identity keys."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast
from urllib.parse import urlparse

from atlas.models.database import db

if TYPE_CHECKING:
    import aiosqlite

IDENTITY_KEY_TYPES = {"ein", "fec_id", "domain"}


class InvalidIdentityKeyError(ValueError):
    """Raised when a stable identity key is unsupported or empty."""


class InvalidConfidenceError(ValueError):
    """Raised when confidence is outside the 0-1 trust scale."""


class InvalidRelationshipEdgeError(ValueError):
    """Raised when a sourced relationship edge is incomplete or invalid."""


@dataclass(frozen=True)
class EntityIdentityKey:
    """A stable key that resolves repeated public mentions to one actor."""

    entry_id: str
    key_type: str
    key_value: str
    source_id: str | None
    confidence: float
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class RelationshipEdge:
    """One source-backed relationship between two actor records."""

    id: str
    source_entry_id: str
    target_entry_id: str
    relationship_type: str
    source_id: str
    evidence_label: str
    confidence: float
    evidence_count: int
    first_seen: str
    last_seen: str
    created_at: str
    updated_at: str


def _normalize_identity_key(key_type: str, key_value: str) -> str:
    """Normalize a public identifier so repeated mentions resolve together."""
    normalized_type = key_type.strip().lower()
    if normalized_type not in IDENTITY_KEY_TYPES:
        raise InvalidIdentityKeyError

    stripped_value = key_value.strip()
    if not stripped_value:
        raise InvalidIdentityKeyError

    if normalized_type == "domain":
        parsed = urlparse(
            stripped_value if "://" in stripped_value else f"https://{stripped_value}"
        )
        host = (parsed.hostname or stripped_value).lower()
        return host.removeprefix("www.")

    if normalized_type == "ein":
        digits = re.sub(r"\D+", "", stripped_value)
        if not digits:
            raise InvalidIdentityKeyError
        return digits

    return re.sub(r"\s+", "", stripped_value).upper()


def _validate_confidence(confidence: float) -> None:
    """Ensure confidence stays in the public trust scale."""
    if confidence < 0 or confidence > 1:
        raise InvalidConfidenceError


def _identity_key_from_row(row: Any) -> EntityIdentityKey:
    """Project a database row into an identity-key model."""
    return EntityIdentityKey(
        entry_id=str(row[0]),
        key_type=str(row[1]),
        key_value=str(row[2]),
        source_id=str(row[3]) if row[3] is not None else None,
        confidence=float(cast("float | int | str", row[4])),
        created_at=str(row[5]),
        updated_at=str(row[6]),
    )


def _edge_from_row(row: Any) -> RelationshipEdge:
    """Project a database row into a relationship-edge model."""
    return RelationshipEdge(
        id=str(row[0]),
        source_entry_id=str(row[1]),
        target_entry_id=str(row[2]),
        relationship_type=str(row[3]),
        source_id=str(row[4]),
        evidence_label=str(row[5]),
        confidence=float(cast("float | int | str", row[6])),
        evidence_count=int(cast("int | str", row[7])),
        first_seen=str(row[8]),
        last_seen=str(row[9]),
        created_at=str(row[10]),
        updated_at=str(row[11]),
    )


class RelationshipCRUD:
    """CRUD helpers for sourced relationships and identity resolution."""

    @staticmethod
    async def upsert_identity_key(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        entry_id: str,
        key_type: str,
        key_value: str,
        source_id: str | None,
        confidence: float,
    ) -> None:
        """
        Attach or refresh a stable identity key for an actor.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Actor record the key identifies.
        key_type : str
            Stable key kind: ``ein``, ``fec_id``, or ``domain``.
        key_value : str
            Raw identifier extracted from a public source.
        source_id : str | None
            Source that supports the key.
        confidence : float
            Trust score from 0 to 1.
        """
        normalized_type = key_type.strip().lower()
        normalized_value = _normalize_identity_key(normalized_type, key_value)
        _validate_confidence(confidence)
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO entity_identity_keys (
                entry_id, key_type, key_value, source_id, confidence, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key_type, key_value) DO UPDATE SET
                entry_id = excluded.entry_id,
                source_id = excluded.source_id,
                confidence = excluded.confidence,
                updated_at = excluded.updated_at
            """,
            (
                entry_id,
                normalized_type,
                normalized_value,
                source_id,
                confidence,
                now,
                now,
            ),
        )
        await conn.commit()

    @staticmethod
    async def resolve_identity_key(
        conn: aiosqlite.Connection,
        *,
        key_type: str,
        key_value: str,
    ) -> str | None:
        """
        Resolve a stable key to an existing actor entry id.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        key_type : str
            Stable key kind.
        key_value : str
            Raw public identifier.

        Returns
        -------
        str | None
            Existing actor id, if Atlas has already seen the key.
        """
        normalized_type = key_type.strip().lower()
        normalized_value = _normalize_identity_key(normalized_type, key_value)
        cursor = await conn.execute(
            """
            SELECT entry_id FROM entity_identity_keys
            WHERE key_type = ? AND key_value = ?
            """,
            (normalized_type, normalized_value),
        )
        row = await cursor.fetchone()
        return str(row[0]) if row else None

    @staticmethod
    async def get_identity_key(
        conn: aiosqlite.Connection,
        *,
        key_type: str,
        key_value: str,
    ) -> EntityIdentityKey | None:
        """Return a persisted identity key record."""
        normalized_type = key_type.strip().lower()
        normalized_value = _normalize_identity_key(normalized_type, key_value)
        cursor = await conn.execute(
            """
            SELECT entry_id, key_type, key_value, source_id, confidence, created_at, updated_at
            FROM entity_identity_keys
            WHERE key_type = ? AND key_value = ?
            """,
            (normalized_type, normalized_value),
        )
        row = await cursor.fetchone()
        return _identity_key_from_row(row) if row else None

    @staticmethod
    async def upsert_edge(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        source_entry_id: str,
        target_entry_id: str,
        relationship_type: str,
        source_id: str,
        evidence_label: str,
        confidence: float,
    ) -> str:
        """
        Persist or strengthen a source-backed actor relationship.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        source_entry_id : str
            Entry where the relationship originates.
        target_entry_id : str
            Entry where the relationship points.
        relationship_type : str
            Semantic relationship label, such as ``staff`` or ``coalition_partner``.
        source_id : str
            Public source supporting the edge.
        evidence_label : str
            Short human-readable evidence phrase.
        confidence : float
            Trust score from 0 to 1.

        Returns
        -------
        str
            Relationship edge id.
        """
        if source_entry_id == target_entry_id:
            raise InvalidRelationshipEdgeError
        normalized_type = relationship_type.strip().lower()
        if not normalized_type:
            raise InvalidRelationshipEdgeError
        normalized_label = evidence_label.strip()
        if not normalized_label:
            raise InvalidRelationshipEdgeError
        _validate_confidence(confidence)

        now = db.now_iso()
        edge_id = db.generate_uuid()
        await conn.execute(
            """
            INSERT INTO entity_relationship_edges (
                id, source_entry_id, target_entry_id, relationship_type, source_id,
                evidence_label, confidence, evidence_count, first_seen, last_seen,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(source_entry_id, target_entry_id, relationship_type, source_id)
            DO UPDATE SET
                evidence_label = excluded.evidence_label,
                -- SQLite spells two-argument maximum MAX(); PostgreSQL spells it
                -- GREATEST(). A CASE expression is the same thing in both, so the
                -- statement needs no dialect awareness.
                confidence = CASE
                    WHEN excluded.confidence > entity_relationship_edges.confidence
                        THEN excluded.confidence
                    ELSE entity_relationship_edges.confidence
                END,
                evidence_count = entity_relationship_edges.evidence_count + 1,
                last_seen = excluded.last_seen,
                updated_at = excluded.updated_at
            """,
            (
                edge_id,
                source_entry_id,
                target_entry_id,
                normalized_type,
                source_id,
                normalized_label,
                confidence,
                now,
                now,
                now,
                now,
            ),
        )
        cursor = await conn.execute(
            """
            SELECT id FROM entity_relationship_edges
            WHERE source_entry_id = ?
            AND target_entry_id = ?
            AND relationship_type = ?
            AND source_id = ?
            """,
            (source_entry_id, target_entry_id, normalized_type, source_id),
        )
        row = await cursor.fetchone()
        assert row is not None, "upserted relationship edge should be readable"
        await conn.commit()
        stored_edge_id = str(row[0])
        from atlas.domains.firehose.producers import record_catalog_relationship_observation

        await record_catalog_relationship_observation(
            conn,
            edge_id=stored_edge_id,
            source_entry_id=source_entry_id,
            target_entry_id=target_entry_id,
            relationship_type=normalized_type,
            source_id=source_id,
            evidence_label=normalized_label,
        )
        return stored_edge_id

    @staticmethod
    async def list_edges_for_entry(
        conn: aiosqlite.Connection,
        entry_id: str,
    ) -> list[RelationshipEdge]:
        """List all source-backed edges touching one actor."""
        cursor = await conn.execute(
            """
            SELECT
                id, source_entry_id, target_entry_id, relationship_type, source_id,
                evidence_label, confidence, evidence_count, first_seen, last_seen,
                created_at, updated_at
            FROM entity_relationship_edges
            WHERE source_entry_id = ? OR target_entry_id = ?
            ORDER BY confidence DESC, evidence_count DESC, updated_at DESC
            """,
            (entry_id, entry_id),
        )
        rows = await cursor.fetchall()
        return [_edge_from_row(row) for row in rows]
