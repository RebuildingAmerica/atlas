"""Auditable relationships between public profiles and ATProto identities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from atlas.platform.database import db


@dataclass(frozen=True, slots=True)
class ProfileAtprotoLinkModel:
    """The current or historical ATProto representation of one profile."""

    id: str
    entry_id: str
    identity_id: str
    claim_id: str | None
    proof_id: str | None
    status: str
    verified_at: str | None
    last_checked_at: str | None
    removed_at: str | None
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class ProfileAtprotoLinkEvidence:
    """Optional claim evidence supporting a verified profile link."""

    claim_id: str | None = None
    proof_id: str | None = None
    verified_at: str | None = None


@dataclass(frozen=True, slots=True)
class VerifiedProfileAtprotoIdentity:
    """Public identity fields derived only from a healthy verified relation."""

    did: str
    handle: str
    verified_at: str | None


@dataclass(frozen=True, slots=True)
class AtprotoLinkedProfileSummary:
    """Public profile summary shown beside an account identity."""

    id: str
    name: str
    slug: str
    type: str


class ProfileAtprotoLinkConflictError(Exception):
    """Raised when replacement was not explicitly authorized."""


class ProfileAtprotoLinkCRUD:
    """Own verified, attention, replacement, and removal transitions."""

    @staticmethod
    async def attach(
        conn: Any,
        *,
        entry_id: str,
        identity_id: str,
        evidence: ProfileAtprotoLinkEvidence | None = None,
        replace: bool = False,
    ) -> ProfileAtprotoLinkModel:
        current = await ProfileAtprotoLinkCRUD.get_current_for_entry(conn, entry_id)
        if current is not None and current.identity_id != identity_id:
            if not replace:
                raise ProfileAtprotoLinkConflictError
            await ProfileAtprotoLinkCRUD.remove(conn, current.id)
            current = None
        now = db.now_iso()
        claim_id = evidence.claim_id if evidence is not None else None
        proof_id = evidence.proof_id if evidence is not None else None
        verified_at = evidence.verified_at if evidence and evidence.verified_at else now
        if current is None:
            link_id = db.generate_uuid()
            await conn.execute(
                """
                INSERT INTO profile_atproto_links (
                    id, entry_id, identity_id, claim_id, proof_id, status,
                    verified_at, last_checked_at, removed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'verified', ?, ?, NULL, ?, ?)
                """,
                (
                    link_id,
                    entry_id,
                    identity_id,
                    claim_id,
                    proof_id,
                    verified_at,
                    now,
                    now,
                    now,
                ),
            )
        else:
            link_id = current.id
            await conn.execute(
                """
                UPDATE profile_atproto_links
                SET claim_id = ?, proof_id = ?, status = 'verified',
                    verified_at = ?, last_checked_at = ?, removed_at = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (claim_id, proof_id, verified_at, now, now, link_id),
            )
        link = await ProfileAtprotoLinkCRUD.get_by_id(conn, link_id)
        if link is None:
            msg = "ATProto profile link disappeared after attach"
            raise RuntimeError(msg)
        return link

    @staticmethod
    async def mark_needs_attention(conn: Any, link_id: str) -> None:
        now = db.now_iso()
        await conn.execute(
            """
            UPDATE profile_atproto_links
            SET status = 'reverification_required', last_checked_at = ?, updated_at = ?
            WHERE id = ? AND status <> 'removed'
            """,
            (now, now, link_id),
        )

    @staticmethod
    async def mark_verified(conn: Any, link_id: str) -> None:
        now = db.now_iso()
        await conn.execute(
            """
            UPDATE profile_atproto_links
            SET status = 'verified', verified_at = ?, last_checked_at = ?,
                removed_at = NULL, updated_at = ?
            WHERE id = ? AND status <> 'removed'
            """,
            (now, now, now, link_id),
        )

    @staticmethod
    async def remove(conn: Any, link_id: str) -> None:
        now = db.now_iso()
        await conn.execute(
            """
            UPDATE profile_atproto_links
            SET status = 'removed', removed_at = ?, updated_at = ? WHERE id = ?
            """,
            (now, now, link_id),
        )

    @staticmethod
    async def get_by_id(conn: Any, link_id: str) -> ProfileAtprotoLinkModel | None:
        cursor = await conn.execute("SELECT * FROM profile_atproto_links WHERE id = ?", (link_id,))
        return await _fetch_link(cursor)

    @staticmethod
    async def get_current_for_entry(conn: Any, entry_id: str) -> ProfileAtprotoLinkModel | None:
        cursor = await conn.execute(
            """
            SELECT * FROM profile_atproto_links
            WHERE entry_id = ? AND status <> 'removed'
            """,
            (entry_id,),
        )
        return await _fetch_link(cursor)

    @staticmethod
    async def list_current(conn: Any) -> list[ProfileAtprotoLinkModel]:
        cursor = await conn.execute(
            "SELECT * FROM profile_atproto_links WHERE status <> 'removed' ORDER BY created_at"
        )
        rows = await cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        return [ProfileAtprotoLinkModel(**dict(zip(columns, row, strict=True))) for row in rows]

    @staticmethod
    async def get_verified_public_identity(
        conn: Any, entry_id: str
    ) -> VerifiedProfileAtprotoIdentity | None:
        """Return public fields only when both the link and DID are healthy."""
        cursor = await conn.execute(
            """
            SELECT identities.did, identities.current_handle, links.verified_at
            FROM profile_atproto_links AS links
            JOIN atproto_identities AS identities ON identities.id = links.identity_id
            WHERE links.entry_id = ?
              AND links.status = 'verified'
              AND identities.resolution_status = 'verified'
            """,
            (entry_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return VerifiedProfileAtprotoIdentity(did=row[0], handle=row[1], verified_at=row[2])

    @staticmethod
    async def list_profile_summaries(
        conn: Any, identity_id: str
    ) -> list[AtprotoLinkedProfileSummary]:
        """List profiles currently represented by an identity."""
        cursor = await conn.execute(
            """
            SELECT entries.id, entries.name, entries.slug, entries.type
            FROM profile_atproto_links AS links
            JOIN entries ON entries.id = links.entry_id
            WHERE links.identity_id = ? AND links.status <> 'removed'
            ORDER BY entries.name, entries.id
            """,
            (identity_id,),
        )
        rows = await cursor.fetchall()
        return [AtprotoLinkedProfileSummary(*row) for row in rows]


async def _fetch_link(cursor: Any) -> ProfileAtprotoLinkModel | None:
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [description[0] for description in cursor.description]
    return ProfileAtprotoLinkModel(**dict(zip(columns, row, strict=True)))
