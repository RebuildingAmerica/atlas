"""Support helpers for profile claim persistence."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Sequence

VERIFICATION_TOKEN_TTL = timedelta(hours=24)


@dataclass
class ProfileClaimModel:
    """Profile claim record."""

    id: str
    entry_id: str
    user_id: str
    user_email: str
    status: str
    tier: int
    evidence_json: str | None
    verification_token: str | None
    verification_token_expires_at: str | None
    verified_at: str | None
    rejected_reason: str | None
    created_at: str
    updated_at: str

    @property
    def evidence(self) -> Any:
        """Parsed evidence payload, if any."""
        if not self.evidence_json:
            return None
        return json.loads(self.evidence_json)


@dataclass
class ProfileClaimProofModel:
    """Proof record supporting one profile-claim decision."""

    id: str
    claim_id: str
    proof_type: str
    proof_status: str
    proof_summary: str
    proof_metadata_json: str | None
    created_at: str
    reviewed_at: str | None
    expires_at: str | None

    @property
    def metadata(self) -> Any:
        """Parsed proof metadata, if any."""
        if not self.proof_metadata_json:
            return None
        return json.loads(self.proof_metadata_json)


def _row_to_claim(row: dict[str, Any]) -> ProfileClaimModel:
    return ProfileClaimModel(
        id=row["id"],
        entry_id=row["entry_id"],
        user_id=row["user_id"],
        user_email=row["user_email"],
        status=row["status"],
        tier=int(row["tier"]),
        evidence_json=row.get("evidence_json"),
        verification_token=row.get("verification_token"),
        verification_token_expires_at=row.get("verification_token_expires_at"),
        verified_at=row.get("verified_at"),
        rejected_reason=row.get("rejected_reason"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_claim_proof(row: Sequence[Any]) -> ProfileClaimProofModel:
    return ProfileClaimProofModel(
        id=str(row[0]),
        claim_id=str(row[1]),
        proof_type=str(row[2]),
        proof_status=str(row[3]),
        proof_summary=str(row[4]),
        proof_metadata_json=str(row[5]) if row[5] is not None else None,
        created_at=str(row[6]),
        reviewed_at=str(row[7]) if row[7] is not None else None,
        expires_at=str(row[8]) if row[8] is not None else None,
    )


def _default_verified_proof_summary(proof_type: str, proof_metadata: Any | None) -> str:
    if proof_type == "email_domain" and isinstance(proof_metadata, dict):
        domain = proof_metadata.get("user_email_domain")
        if isinstance(domain, str) and domain:
            return f"Verified email control for {domain}."
    return "Verified by reviewer decision."
