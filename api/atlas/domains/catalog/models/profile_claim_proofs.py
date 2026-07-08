"""Proof persistence helpers for profile claims."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

from .profile_claims_support import ProfileClaimProofModel, _row_to_claim_proof

if TYPE_CHECKING:
    import aiosqlite


async def record_proof(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    claim_id: str,
    proof_type: str,
    proof_status: str,
    proof_summary: str,
    proof_metadata: Any | None = None,
    reviewed_at: str | None = None,
    expires_at: str | None = None,
) -> ProfileClaimProofModel:
    """Record one proof artifact or reviewer decision for a claim."""
    proof_id = db.generate_uuid()
    now = db.now_iso()
    metadata_json = json.dumps(proof_metadata, sort_keys=True) if proof_metadata else None
    await conn.execute(
        """
        INSERT INTO profile_claim_proofs (
            id, claim_id, proof_type, proof_status, proof_summary,
            proof_metadata_json, created_at, reviewed_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            proof_id,
            claim_id,
            proof_type,
            proof_status,
            proof_summary,
            metadata_json,
            now,
            reviewed_at,
            expires_at,
        ),
    )
    await conn.commit()
    return ProfileClaimProofModel(
        id=proof_id,
        claim_id=claim_id,
        proof_type=proof_type,
        proof_status=proof_status,
        proof_summary=proof_summary,
        proof_metadata_json=metadata_json,
        created_at=now,
        reviewed_at=reviewed_at,
        expires_at=expires_at,
    )


async def list_proofs(
    conn: aiosqlite.Connection,
    claim_id: str,
) -> list[ProfileClaimProofModel]:
    """Return proof records for one claim, newest first."""
    cursor = await conn.execute(
        """
        SELECT id, claim_id, proof_type, proof_status, proof_summary,
               proof_metadata_json, created_at, reviewed_at, expires_at
        FROM profile_claim_proofs
        WHERE claim_id = ?
        ORDER BY created_at DESC
        """,
        (claim_id,),
    )
    rows = await cursor.fetchall()
    return [_row_to_claim_proof(row) for row in rows]


async def mark_proof_verified(
    conn: aiosqlite.Connection,
    proof_id: str,
    *,
    proof_metadata: Any | None = None,
) -> ProfileClaimProofModel | None:
    """Transition one pending proof record to verified."""
    now = db.now_iso()
    metadata_json = json.dumps(proof_metadata, sort_keys=True) if proof_metadata else None
    cursor = await conn.execute(
        """
        UPDATE profile_claim_proofs
        SET proof_status = 'verified',
            proof_metadata_json = COALESCE(?, proof_metadata_json),
            reviewed_at = ?
        WHERE id = ?
        """,
        (metadata_json, now, proof_id),
    )
    await conn.commit()
    if cursor.rowcount == 0:
        return None
    cursor = await conn.execute(
        """
        SELECT id, claim_id, proof_type, proof_status, proof_summary,
               proof_metadata_json, created_at, reviewed_at, expires_at
        FROM profile_claim_proofs
        WHERE id = ?
        """,
        (proof_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return _row_to_claim_proof(row)
