"""Firehose artifact persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .model_records import (
    FirehoseArtifactCreate,
    FirehoseArtifactModel,
    artifact_from_row,
    row_dict,
)

if TYPE_CHECKING:
    import aiosqlite


async def artifact_by_id(
    conn: aiosqlite.Connection,
    artifact_id: str,
) -> FirehoseArtifactModel:
    """Return one artifact by id."""
    cursor = await conn.execute("SELECT * FROM firehose_artifacts WHERE id = ?", (artifact_id,))
    row = await cursor.fetchone()
    assert row is not None, "artifact exists for stored signal"
    return artifact_from_row(row_dict(cursor, row))


class FirehoseArtifactCRUD:
    """CRUD operations for Firehose artifacts."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        artifact_input: FirehoseArtifactCreate,
    ) -> FirehoseArtifactModel:
        """Create one artifact unless the same source fingerprint already exists."""
        cursor = await conn.execute(
            """
            SELECT * FROM firehose_artifacts
            WHERE source_target_id = ? AND fingerprint = ?
            """,
            (artifact_input.source_target_id, artifact_input.fingerprint),
        )
        row = await cursor.fetchone()
        if row is not None:
            return artifact_from_row(row_dict(cursor, row))

        artifact_id = db.generate_uuid()
        await conn.execute(
            """
            INSERT INTO firehose_artifacts (
                id, source_target_id, org_id, coverage_target_id, source_url,
                canonical_url, title, publisher, source_kind, source_class, published_at,
                detected_at, fetched_at, content_hash, fingerprint, relevant_text,
                raw_content, http_status, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                artifact_input.source_target_id,
                artifact_input.org_id,
                artifact_input.coverage_target_id,
                artifact_input.source_url,
                artifact_input.canonical_url,
                artifact_input.title,
                artifact_input.publisher,
                artifact_input.source_kind,
                artifact_input.source_class,
                artifact_input.published_at,
                artifact_input.detected_at,
                artifact_input.fetched_at,
                artifact_input.content_hash,
                artifact_input.fingerprint,
                artifact_input.relevant_text,
                artifact_input.raw_content,
                artifact_input.http_status,
                db.encode_json(artifact_input.metadata),
                db.now_iso(),
            ),
        )
        await conn.commit()
        return await artifact_by_id(conn, artifact_id)
