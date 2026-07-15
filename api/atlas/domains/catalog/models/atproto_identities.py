"""Global ATProto identity records keyed by durable DID."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from atlas.platform.database import db


@dataclass(frozen=True, slots=True)
class AtprotoIdentityModel:
    """Current resolution metadata for one globally unique ATProto DID."""

    id: str
    did: str
    current_handle: str
    pds_url: str | None
    resolution_status: str
    did_resolved_at: str | None
    handle_verified_at: str | None
    last_resolution_error: str | None
    created_at: str
    updated_at: str


class AtprotoIdentityCRUD:
    """Read and write global DID metadata without assigning user ownership."""

    @staticmethod
    async def upsert(
        conn: Any,
        *,
        did: str,
        handle: str,
        pds_url: str | None = None,
    ) -> AtprotoIdentityModel:
        """Create or refresh the globally unique record for ``did``."""
        existing = await AtprotoIdentityCRUD.get_by_did(conn, did)
        now = db.now_iso()
        if existing is None:
            identity_id = db.generate_uuid()
            await conn.execute(
                """
                INSERT INTO atproto_identities (
                    id, did, current_handle, pds_url, resolution_status,
                    did_resolved_at, handle_verified_at, last_resolution_error,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'verified', ?, ?, NULL, ?, ?)
                """,
                (identity_id, did, handle, pds_url, now, now, now, now),
            )
            identity = await AtprotoIdentityCRUD.get_by_id(conn, identity_id)
        else:
            await conn.execute(
                """
                UPDATE atproto_identities
                SET current_handle = ?, pds_url = ?, resolution_status = 'verified',
                    did_resolved_at = ?, handle_verified_at = ?,
                    last_resolution_error = NULL, updated_at = ?
                WHERE id = ?
                """,
                (handle, pds_url, now, now, now, existing.id),
            )
            identity = await AtprotoIdentityCRUD.get_by_id(conn, existing.id)
        if identity is None:
            msg = "ATProto identity disappeared after upsert"
            raise RuntimeError(msg)
        return identity

    @staticmethod
    async def mark_needs_attention(conn: Any, identity_id: str, *, error: str) -> None:
        """Retain a DID while recording that its current resolution is unhealthy."""
        now = db.now_iso()
        await conn.execute(
            """
            UPDATE atproto_identities
            SET resolution_status = 'needs_attention',
                last_resolution_error = ?, updated_at = ?
            WHERE id = ?
            """,
            (error, now, identity_id),
        )

    @staticmethod
    async def get_by_id(conn: Any, identity_id: str) -> AtprotoIdentityModel | None:
        """Fetch a global identity by opaque id."""
        cursor = await conn.execute("SELECT * FROM atproto_identities WHERE id = ?", (identity_id,))
        return await _fetch_identity(cursor)

    @staticmethod
    async def get_by_did(conn: Any, did: str) -> AtprotoIdentityModel | None:
        """Fetch the globally unique identity for ``did``."""
        cursor = await conn.execute("SELECT * FROM atproto_identities WHERE did = ?", (did,))
        return await _fetch_identity(cursor)

    @staticmethod
    async def get_by_current_handle(conn: Any, handle: str) -> AtprotoIdentityModel | None:
        """Fetch the verified identity currently using ``handle``."""
        cursor = await conn.execute(
            """
            SELECT *
            FROM atproto_identities
            WHERE lower(current_handle) = lower(?)
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (handle,),
        )
        return await _fetch_identity(cursor)


async def _fetch_identity(cursor: Any) -> AtprotoIdentityModel | None:
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [description[0] for description in cursor.description]
    values = dict(zip(columns, row, strict=True))
    return AtprotoIdentityModel(
        id=values["id"],
        did=values["did"],
        current_handle=values["current_handle"],
        pds_url=values["pds_url"],
        resolution_status=values["resolution_status"],
        did_resolved_at=values["did_resolved_at"],
        handle_verified_at=values["handle_verified_at"],
        last_resolution_error=values["last_resolution_error"],
        created_at=values["created_at"],
        updated_at=values["updated_at"],
    )
