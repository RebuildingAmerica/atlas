"""Verified Atlas-user control relationships for global ATProto identities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from atlas.domains.catalog.models.atproto_identities import (
    AtprotoIdentityCRUD,
    AtprotoIdentityModel,
)
from atlas.platform.database import db


@dataclass(frozen=True, slots=True)
class AtprotoIdentityControlModel:
    """One user's current control state for a global ATProto identity."""

    id: str
    identity_id: str
    user_id: str
    status: str
    verified_at: str | None
    disconnected_at: str | None
    created_at: str
    updated_at: str


class AtprotoIdentityControlConflictError(Exception):
    """Raised without controller metadata when another user controls a DID."""


class AtprotoIdentityControlCRUD:
    """Own control transitions independently from global DID metadata."""

    @staticmethod
    async def connect(
        conn: Any,
        *,
        user_id: str,
        did: str,
        handle: str,
        pds_url: str | None = None,
    ) -> tuple[AtprotoIdentityModel, AtprotoIdentityControlModel]:
        """Activate ``user_id`` control after verified OAuth proof."""
        identity = await AtprotoIdentityCRUD.upsert(conn, did=did, handle=handle, pds_url=pds_url)
        active = await AtprotoIdentityControlCRUD.get_active_for_identity(conn, identity.id)
        if active is not None and active.user_id != user_id:
            await AtprotoIdentityControlCRUD._record_conflict(
                conn, identity_id=identity.id, user_id=user_id
            )
            raise AtprotoIdentityControlConflictError

        existing = await AtprotoIdentityControlCRUD.get_for_user_and_identity(
            conn, user_id=user_id, identity_id=identity.id
        )
        now = db.now_iso()
        if existing is None:
            control_id = db.generate_uuid()
            await conn.execute(
                """
                INSERT INTO user_atproto_controls (
                    id, identity_id, user_id, status, verified_at,
                    disconnected_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, NULL, ?, ?)
                """,
                (control_id, identity.id, user_id, now, now, now),
            )
        else:
            control_id = existing.id
            await conn.execute(
                """
                UPDATE user_atproto_controls
                SET status = 'active', verified_at = ?, disconnected_at = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (now, now, control_id),
            )
        control = await AtprotoIdentityControlCRUD.get_by_id(conn, control_id)
        if control is None:
            msg = "ATProto identity control disappeared after connect"
            raise RuntimeError(msg)
        return identity, control

    @staticmethod
    async def disconnect(conn: Any, *, user_id: str, identity_id: str) -> bool:
        """Disconnect only the user's control, retaining identity and profile links."""
        now = db.now_iso()
        cursor = await conn.execute(
            """
            UPDATE user_atproto_controls
            SET status = 'disconnected', disconnected_at = ?, updated_at = ?
            WHERE user_id = ? AND identity_id = ? AND status <> 'disconnected'
            """,
            (now, now, user_id, identity_id),
        )
        return bool(cursor.rowcount)

    @staticmethod
    async def get_by_id(conn: Any, control_id: str) -> AtprotoIdentityControlModel | None:
        cursor = await conn.execute(
            "SELECT * FROM user_atproto_controls WHERE id = ?", (control_id,)
        )
        return await _fetch_control(cursor)

    @staticmethod
    async def get_active_for_identity(
        conn: Any, identity_id: str
    ) -> AtprotoIdentityControlModel | None:
        cursor = await conn.execute(
            "SELECT * FROM user_atproto_controls WHERE identity_id = ? AND status = 'active'",
            (identity_id,),
        )
        return await _fetch_control(cursor)

    @staticmethod
    async def get_active_for_user_and_identity(
        conn: Any, *, user_id: str, identity_id: str
    ) -> AtprotoIdentityControlModel | None:
        cursor = await conn.execute(
            """
            SELECT * FROM user_atproto_controls
            WHERE user_id = ? AND identity_id = ? AND status = 'active'
            """,
            (user_id, identity_id),
        )
        return await _fetch_control(cursor)

    @staticmethod
    async def get_for_user_and_identity(
        conn: Any, *, user_id: str, identity_id: str
    ) -> AtprotoIdentityControlModel | None:
        cursor = await conn.execute(
            "SELECT * FROM user_atproto_controls WHERE user_id = ? AND identity_id = ?",
            (user_id, identity_id),
        )
        return await _fetch_control(cursor)

    @staticmethod
    async def list_for_user(conn: Any, user_id: str) -> list[AtprotoIdentityControlModel]:
        """List current controls, excluding disconnected history."""
        cursor = await conn.execute(
            """
            SELECT * FROM user_atproto_controls
            WHERE user_id = ? AND status <> 'disconnected'
            ORDER BY created_at
            """,
            (user_id,),
        )
        rows = await cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        return [AtprotoIdentityControlModel(**dict(zip(columns, row, strict=True))) for row in rows]

    @staticmethod
    async def _record_conflict(conn: Any, *, identity_id: str, user_id: str) -> None:
        existing = await AtprotoIdentityControlCRUD.get_for_user_and_identity(
            conn, user_id=user_id, identity_id=identity_id
        )
        now = db.now_iso()
        if existing is None:
            await conn.execute(
                """
                INSERT INTO user_atproto_controls (
                    id, identity_id, user_id, status, verified_at,
                    disconnected_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'conflict', NULL, NULL, ?, ?)
                """,
                (db.generate_uuid(), identity_id, user_id, now, now),
            )
        else:
            await conn.execute(
                """
                UPDATE user_atproto_controls
                SET status = 'conflict', verified_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now, existing.id),
            )


async def _fetch_control(cursor: Any) -> AtprotoIdentityControlModel | None:
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [description[0] for description in cursor.description]
    values = dict(zip(columns, row, strict=True))
    return AtprotoIdentityControlModel(**values)
