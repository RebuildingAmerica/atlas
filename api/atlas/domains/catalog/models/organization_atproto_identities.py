"""Organization ownership relationships for verified ATProto identities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from atlas.platform.database import db


@dataclass(frozen=True, slots=True)
class OrganizationAtprotoIdentityModel:
    id: str
    organization_id: str
    identity_id: str
    status: str
    attached_by: str
    attached_at: str
    detached_by: str | None
    detached_at: str | None
    created_at: str
    updated_at: str


class OrganizationAtprotoIdentityConflictError(Exception):
    """Raised when a different active identity already represents an organization."""


class OrganizationAtprotoIdentityInvariantError(RuntimeError):
    """Raised when a persisted organization identity cannot be read back."""


class OrganizationAtprotoIdentityCRUD:
    """Maintain one current, auditable ATProto identity per organization."""

    @staticmethod
    async def attach(
        conn: Any, *, organization_id: str, identity_id: str, attached_by: str
    ) -> OrganizationAtprotoIdentityModel:
        active = await OrganizationAtprotoIdentityCRUD.get_active(conn, organization_id)
        if active is not None and active.identity_id != identity_id:
            raise OrganizationAtprotoIdentityConflictError
        now = db.now_iso()
        existing = await OrganizationAtprotoIdentityCRUD.get_for_organization_and_identity(
            conn, organization_id=organization_id, identity_id=identity_id
        )
        if existing is None:
            relation_id = db.generate_uuid()
            await conn.execute(
                """
                INSERT INTO organization_atproto_identities (
                    id, organization_id, identity_id, status, attached_by, attached_at,
                    detached_by, detached_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL, ?, ?)
                """,
                (relation_id, organization_id, identity_id, attached_by, now, now, now),
            )
        else:
            relation_id = existing.id
            await conn.execute(
                """
                UPDATE organization_atproto_identities
                SET status = 'active', attached_by = ?, attached_at = ?, detached_by = NULL,
                    detached_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (attached_by, now, now, relation_id),
            )
        result = await OrganizationAtprotoIdentityCRUD.get_by_id(conn, relation_id)
        if result is None:
            raise OrganizationAtprotoIdentityInvariantError
        return result

    @staticmethod
    async def get_active(
        conn: Any, organization_id: str
    ) -> OrganizationAtprotoIdentityModel | None:
        cursor = await conn.execute(
            """SELECT * FROM organization_atproto_identities
               WHERE organization_id = ? AND status = 'active'""",
            (organization_id,),
        )
        return await _fetch(cursor)

    @staticmethod
    async def detach(
        conn: Any, *, relation_id: str, detached_by: str
    ) -> OrganizationAtprotoIdentityModel:
        """Remove the public organization association without touching DID control."""
        now = db.now_iso()
        await conn.execute(
            """
            UPDATE organization_atproto_identities
            SET status = 'removed', detached_by = ?, detached_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active'
            """,
            (detached_by, now, now, relation_id),
        )
        result = await OrganizationAtprotoIdentityCRUD.get_by_id(conn, relation_id)
        if result is None:
            raise OrganizationAtprotoIdentityInvariantError
        return result

    @staticmethod
    async def get_for_organization_and_identity(
        conn: Any, *, organization_id: str, identity_id: str
    ) -> OrganizationAtprotoIdentityModel | None:
        cursor = await conn.execute(
            """SELECT * FROM organization_atproto_identities
               WHERE organization_id = ? AND identity_id = ?""",
            (organization_id, identity_id),
        )
        return await _fetch(cursor)

    @staticmethod
    async def get_by_id(conn: Any, relation_id: str) -> OrganizationAtprotoIdentityModel | None:
        return await _fetch(
            await conn.execute(
                "SELECT * FROM organization_atproto_identities WHERE id = ?", (relation_id,)
            )
        )


async def _fetch(cursor: Any) -> OrganizationAtprotoIdentityModel | None:
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [description[0] for description in cursor.description]
    return OrganizationAtprotoIdentityModel(**dict(zip(columns, row, strict=True)))
