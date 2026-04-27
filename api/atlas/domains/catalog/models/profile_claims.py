"""
Profile claim CRUD.

A profile claim records a user's assertion of ownership over a profile entry.
Tier-1 claims auto-verify when the requester proves control of an email at the
domain associated with the entry's contact details. Tier-2 claims require
manual review by a moderator.
"""

from __future__ import annotations

import json
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["VERIFICATION_TOKEN_TTL", "ProfileClaimCRUD", "ProfileClaimModel"]

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


class ProfileClaimCRUD:
    """CRUD operations for profile claims."""

    @staticmethod
    def generate_token() -> str:
        """Return a URL-safe verification token (256 bits of entropy)."""
        return secrets.token_urlsafe(32)

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        entry_id: str,
        user_id: str,
        user_email: str,
        tier: int,
        evidence: Any | None = None,
        verification_token: str | None = None,
        token_ttl: timedelta = VERIFICATION_TOKEN_TTL,
    ) -> ProfileClaimModel:
        """Create a new pending claim record."""
        claim_id = db.generate_uuid()
        now = db.now_iso()
        token = verification_token if tier == 1 else None
        if tier == 1 and token is None:
            token = ProfileClaimCRUD.generate_token()
        expires_at = (datetime.now(UTC) + token_ttl).isoformat() if tier == 1 and token else None
        evidence_json = json.dumps(evidence) if evidence is not None else None
        await conn.execute(
            """
            INSERT INTO profile_claims (
                id, entry_id, user_id, user_email, status, tier,
                evidence_json, verification_token, verification_token_expires_at,
                verified_at, rejected_reason, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?)
            """,
            (
                claim_id,
                entry_id,
                user_id,
                user_email,
                tier,
                evidence_json,
                token,
                expires_at,
                now,
                now,
            ),
        )
        await conn.commit()
        return ProfileClaimModel(
            id=claim_id,
            entry_id=entry_id,
            user_id=user_id,
            user_email=user_email,
            status="pending",
            tier=tier,
            evidence_json=evidence_json,
            verification_token=token,
            verification_token_expires_at=expires_at,
            verified_at=None,
            rejected_reason=None,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, claim_id: str) -> ProfileClaimModel | None:
        """Fetch a claim by id."""
        cursor = await conn.execute(
            "SELECT * FROM profile_claims WHERE id = ?",
            (claim_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return _row_to_claim(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def get_by_token(conn: aiosqlite.Connection, token: str) -> ProfileClaimModel | None:
        """Fetch a pending claim by its verification token."""
        cursor = await conn.execute(
            "SELECT * FROM profile_claims WHERE verification_token = ?",
            (token,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return _row_to_claim(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def list_by_user(conn: aiosqlite.Connection, user_id: str) -> list[ProfileClaimModel]:
        """Return all claims belonging to one user, newest first."""
        cursor = await conn.execute(
            "SELECT * FROM profile_claims WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [desc[0] for desc in cursor.description]
        return [_row_to_claim(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def list_by_entry(conn: aiosqlite.Connection, entry_id: str) -> list[ProfileClaimModel]:
        """Return all claims for one entry, newest first."""
        cursor = await conn.execute(
            "SELECT * FROM profile_claims WHERE entry_id = ? ORDER BY created_at DESC",
            (entry_id,),
        )
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [desc[0] for desc in cursor.description]
        return [_row_to_claim(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def get_active_for_entry(
        conn: aiosqlite.Connection, entry_id: str
    ) -> ProfileClaimModel | None:
        """Return the verified or pending claim for an entry, if any."""
        cursor = await conn.execute(
            """
            SELECT * FROM profile_claims
            WHERE entry_id = ? AND status IN ('verified', 'pending')
            ORDER BY CASE status WHEN 'verified' THEN 0 ELSE 1 END, created_at DESC
            LIMIT 1
            """,
            (entry_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return _row_to_claim(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def mark_verified(conn: aiosqlite.Connection, claim_id: str) -> ProfileClaimModel | None:
        """Transition a claim to verified and stamp the verification time."""
        now = db.now_iso()
        cursor = await conn.execute(
            """
            UPDATE profile_claims
            SET status = 'verified',
                verified_at = ?,
                verification_token = NULL,
                verification_token_expires_at = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (now, now, claim_id),
        )
        await conn.commit()
        if cursor.rowcount == 0:
            return None
        return await ProfileClaimCRUD.get_by_id(conn, claim_id)

    @staticmethod
    async def mark_rejected(
        conn: aiosqlite.Connection, claim_id: str, reason: str
    ) -> ProfileClaimModel | None:
        """Reject a pending claim with a reason."""
        now = db.now_iso()
        cursor = await conn.execute(
            """
            UPDATE profile_claims
            SET status = 'rejected',
                rejected_reason = ?,
                verification_token = NULL,
                verification_token_expires_at = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (reason, now, claim_id),
        )
        await conn.commit()
        if cursor.rowcount == 0:
            return None
        return await ProfileClaimCRUD.get_by_id(conn, claim_id)

    @staticmethod
    async def revoke(
        conn: aiosqlite.Connection, claim_id: str, reason: str
    ) -> ProfileClaimModel | None:
        """Revoke a previously verified claim."""
        now = db.now_iso()
        cursor = await conn.execute(
            """
            UPDATE profile_claims
            SET status = 'revoked',
                rejected_reason = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (reason, now, claim_id),
        )
        await conn.commit()
        if cursor.rowcount == 0:
            return None
        return await ProfileClaimCRUD.get_by_id(conn, claim_id)


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
