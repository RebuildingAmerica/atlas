"""Revocable authorization to administer an organization ATProto identity."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from atlas.platform.database import db


@dataclass(frozen=True, slots=True)
class AtprotoIdentityDelegationModel:
    id: str
    organization_id: str
    identity_id: str
    controller_user_id: str
    delegate_user_id: str
    status: str
    granted_by: str
    granted_at: str
    revoked_by: str | None
    revoked_at: str | None
    created_at: str
    updated_at: str


class AtprotoIdentityDelegationNotFoundError(LookupError):
    """Raised when the requested delegation has no auditable record."""


class AtprotoIdentityDelegationInvariantError(RuntimeError):
    """Raised when a persisted delegation cannot be read back."""


class AtprotoIdentityDelegationCRUD:
    """Grant and revoke workspace-scoped administration without moving control."""

    @staticmethod
    async def grant(  # noqa: PLR0913 - relation audit fields are explicit
        conn: Any,
        *,
        organization_id: str,
        identity_id: str,
        controller_user_id: str,
        delegate_user_id: str,
        granted_by: str,
    ) -> AtprotoIdentityDelegationModel:
        now = db.now_iso()
        existing = await AtprotoIdentityDelegationCRUD.get(
            conn,
            organization_id=organization_id,
            identity_id=identity_id,
            delegate_user_id=delegate_user_id,
        )
        if existing is None:
            delegation_id = db.generate_uuid()
            await conn.execute(
                """
                INSERT INTO atproto_identity_delegations (
                    id, organization_id, identity_id, controller_user_id, delegate_user_id,
                    status, granted_by, granted_at, revoked_by, revoked_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?, ?)
                """,
                (
                    delegation_id,
                    organization_id,
                    identity_id,
                    controller_user_id,
                    delegate_user_id,
                    granted_by,
                    now,
                    now,
                    now,
                ),
            )
        else:
            delegation_id = existing.id
            await conn.execute(
                """
                UPDATE atproto_identity_delegations
                SET controller_user_id = ?, status = 'active', granted_by = ?, granted_at = ?,
                    revoked_by = NULL, revoked_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (controller_user_id, granted_by, now, now, delegation_id),
            )
        result = await AtprotoIdentityDelegationCRUD.get_by_id(conn, delegation_id)
        if result is None:
            raise AtprotoIdentityDelegationInvariantError
        return result

    @staticmethod
    async def revoke(
        conn: Any,
        *,
        organization_id: str,
        identity_id: str,
        delegate_user_id: str,
        revoked_by: str,
    ) -> AtprotoIdentityDelegationModel:
        existing = await AtprotoIdentityDelegationCRUD.get(
            conn,
            organization_id=organization_id,
            identity_id=identity_id,
            delegate_user_id=delegate_user_id,
        )
        if existing is None:
            raise AtprotoIdentityDelegationNotFoundError
        now = db.now_iso()
        await conn.execute(
            """UPDATE atproto_identity_delegations
               SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
               WHERE id = ?""",
            (revoked_by, now, now, existing.id),
        )
        result = await AtprotoIdentityDelegationCRUD.get_by_id(conn, existing.id)
        if result is None:
            raise AtprotoIdentityDelegationInvariantError
        return result

    @staticmethod
    async def is_active_delegate(
        conn: Any, *, organization_id: str, identity_id: str, delegate_user_id: str
    ) -> bool:
        row = await AtprotoIdentityDelegationCRUD.get(
            conn,
            organization_id=organization_id,
            identity_id=identity_id,
            delegate_user_id=delegate_user_id,
        )
        return row is not None and row.status == "active"

    @staticmethod
    async def list_active(
        conn: Any, *, organization_id: str, identity_id: str
    ) -> list[AtprotoIdentityDelegationModel]:
        cursor = await conn.execute(
            """SELECT * FROM atproto_identity_delegations
               WHERE organization_id = ? AND identity_id = ? AND status = 'active'
               ORDER BY granted_at ASC, id ASC""",
            (organization_id, identity_id),
        )
        return await _fetch_all(cursor)

    @staticmethod
    async def get(
        conn: Any, *, organization_id: str, identity_id: str, delegate_user_id: str
    ) -> AtprotoIdentityDelegationModel | None:
        return await _fetch(
            await conn.execute(
                """SELECT * FROM atproto_identity_delegations
                   WHERE organization_id = ? AND identity_id = ? AND delegate_user_id = ?""",
                (organization_id, identity_id, delegate_user_id),
            )
        )

    @staticmethod
    async def get_by_id(conn: Any, delegation_id: str) -> AtprotoIdentityDelegationModel | None:
        return await _fetch(
            await conn.execute(
                "SELECT * FROM atproto_identity_delegations WHERE id = ?", (delegation_id,)
            )
        )


async def _fetch(cursor: Any) -> AtprotoIdentityDelegationModel | None:
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [description[0] for description in cursor.description]
    return AtprotoIdentityDelegationModel(**dict(zip(columns, row, strict=True)))


async def _fetch_all(cursor: Any) -> list[AtprotoIdentityDelegationModel]:
    rows = await cursor.fetchall()
    columns = [description[0] for description in cursor.description]
    return [AtprotoIdentityDelegationModel(**dict(zip(columns, row, strict=True))) for row in rows]
