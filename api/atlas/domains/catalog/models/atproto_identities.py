"""ATProto linked identity records for profile claim proof."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite


@dataclass(frozen=True, slots=True)
class AtprotoIdentityModel:
    """A DID-backed ATProto identity linked to one Atlas user."""

    id: str
    user_id: str
    did: str
    current_handle: str
    pds_url: str | None
    did_resolved_at: str
    handle_verified_at: str | None
    created_at: str
    updated_at: str


class AtprotoIdentityCRUD:
    """CRUD operations for user-linked ATProto identities."""

    @staticmethod
    async def upsert(
        conn: aiosqlite.Connection,
        *,
        user_id: str,
        did: str,
        handle: str,
        pds_url: str | None = None,
    ) -> AtprotoIdentityModel:
        """Create or refresh a DID-backed ATProto identity for ``user_id``."""
        existing = await AtprotoIdentityCRUD.get_by_user_and_did(conn, user_id=user_id, did=did)
        now = db.now_iso()
        if existing is not None:
            await conn.execute(
                """
                UPDATE atproto_identities
                SET current_handle = ?, pds_url = ?, did_resolved_at = ?,
                    handle_verified_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (handle, pds_url, now, now, now, existing.id),
            )
            await conn.commit()
            refreshed = await AtprotoIdentityCRUD.get_by_id(conn, existing.id)
            if refreshed is None:
                msg = "ATProto identity disappeared after update"
                raise RuntimeError(msg)
            return refreshed

        identity_id = db.generate_uuid()
        await conn.execute(
            """
            INSERT INTO atproto_identities (
                id, user_id, did, current_handle, pds_url, did_resolved_at,
                handle_verified_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (identity_id, user_id, did, handle, pds_url, now, now, now, now),
        )
        await conn.commit()
        return AtprotoIdentityModel(
            id=identity_id,
            user_id=user_id,
            did=did,
            current_handle=handle,
            pds_url=pds_url,
            did_resolved_at=now,
            handle_verified_at=now,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        identity_id: str,
    ) -> AtprotoIdentityModel | None:
        """Fetch a linked ATProto identity by id."""
        cursor = await conn.execute(
            "SELECT * FROM atproto_identities WHERE id = ?",
            (identity_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return _row_to_identity(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def get_by_user_and_did(
        conn: aiosqlite.Connection,
        *,
        user_id: str,
        did: str,
    ) -> AtprotoIdentityModel | None:
        """Fetch one user's linked record for ``did``."""
        cursor = await conn.execute(
            "SELECT * FROM atproto_identities WHERE user_id = ? AND did = ?",
            (user_id, did),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return _row_to_identity(dict(zip(columns, row, strict=False)))


def _row_to_identity(row: dict[str, Any]) -> AtprotoIdentityModel:
    return AtprotoIdentityModel(
        id=row["id"],
        user_id=row["user_id"],
        did=row["did"],
        current_handle=row["current_handle"],
        pds_url=row.get("pds_url"),
        did_resolved_at=row["did_resolved_at"],
        handle_verified_at=row.get("handle_verified_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
