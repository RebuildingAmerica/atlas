"""Directory ownership persistence helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .ownership_models import (
    DirectoryDomainAlreadyClaimedError,
    DirectoryDomainModel,
    OwnershipModel,
)

if TYPE_CHECKING:
    from collections.abc import Iterable

    import aiosqlite


async def create_ownership(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    resource_id: str,
    resource_type: str,
    org_id: str,
    visibility: str = "public",
    created_by: str,
) -> OwnershipModel:
    """Create an ownership record for a resource."""
    now = db.now_iso()
    await conn.execute(
        """INSERT INTO resource_ownership
           (resource_id, resource_type, org_id, visibility, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (resource_id, resource_type, org_id, visibility, created_by, now),
    )
    await conn.commit()
    return OwnershipModel(
        resource_id=resource_id,
        resource_type=resource_type,
        org_id=org_id,
        visibility=visibility,
        created_by=created_by,
        created_at=now,
    )


async def get_ownership(
    conn: aiosqlite.Connection,
    resource_id: str,
    resource_type: str,
) -> OwnershipModel | None:
    """Get ownership record for a resource."""
    cursor = await conn.execute(
        """SELECT resource_id, resource_type, org_id, visibility, created_by, created_at
           FROM resource_ownership
           WHERE resource_id = ? AND resource_type = ?""",
        (resource_id, resource_type),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return OwnershipModel(
        resource_id=row[0],
        resource_type=row[1],
        org_id=row[2],
        visibility=row[3],
        created_by=row[4],
        created_at=row[5],
    )


async def list_by_org(
    conn: aiosqlite.Connection,
    org_id: str,
    resource_type: str,
    visibility: str | None = None,
) -> list[OwnershipModel]:
    """List ownership records for an org, optionally filtered by visibility."""
    if visibility:
        cursor = await conn.execute(
            """SELECT resource_id, resource_type, org_id, visibility, created_by, created_at
               FROM resource_ownership
               WHERE org_id = ? AND resource_type = ? AND visibility = ?""",
            (org_id, resource_type, visibility),
        )
    else:
        cursor = await conn.execute(
            """SELECT resource_id, resource_type, org_id, visibility, created_by, created_at
               FROM resource_ownership
               WHERE org_id = ? AND resource_type = ?""",
            (org_id, resource_type),
        )
    rows = await cursor.fetchall()
    return [
        OwnershipModel(
            resource_id=r[0],
            resource_type=r[1],
            org_id=r[2],
            visibility=r[3],
            created_by=r[4],
            created_at=r[5],
        )
        for r in rows
    ]


async def delete_ownership(
    conn: aiosqlite.Connection,
    resource_id: str,
    resource_type: str,
) -> bool:
    """Delete an ownership record. Returns True if deleted."""
    cursor = await conn.execute(
        """DELETE FROM resource_ownership
           WHERE resource_id = ? AND resource_type = ?""",
        (resource_id, resource_type),
    )
    await conn.commit()
    return cursor.rowcount > 0


async def update_visibility(
    conn: aiosqlite.Connection,
    *,
    resource_id: str,
    resource_type: str,
    visibility: str,
) -> OwnershipModel | None:
    """Update a resource ownership record's public/private visibility."""
    await conn.execute(
        """UPDATE resource_ownership
           SET visibility = ?
           WHERE resource_id = ? AND resource_type = ?""",
        (visibility, resource_id, resource_type),
    )
    await conn.commit()
    return await get_ownership(conn, resource_id, resource_type)


async def upsert_directory_domain(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    domain: str,
) -> DirectoryDomainModel:
    """Create or replace a workspace directory domain singleton."""
    normalized_domain = domain.strip().lower()
    current = await get_directory_domain(conn, org_id)
    if current is not None and current.domain == normalized_domain:
        return current

    existing = await get_directory_domain_by_domain(conn, normalized_domain)
    if existing is not None and existing.org_id != org_id:
        raise DirectoryDomainAlreadyClaimedError

    verification_token = f"atlas-verify={db.generate_uuid()}"
    now = db.now_iso()
    await conn.execute(
        """
        INSERT INTO org_directory_domains (
            org_id, domain, verification_token, status, created_at, verified_at
        )
        VALUES (?, ?, ?, 'pending', ?, NULL)
        ON CONFLICT(org_id) DO UPDATE SET
            domain = excluded.domain,
            verification_token = excluded.verification_token,
            status = 'pending',
            verified_at = NULL
        """,
        (org_id, normalized_domain, verification_token, now),
    )
    await conn.commit()
    return DirectoryDomainModel(
        org_id=org_id,
        domain=normalized_domain,
        verification_token=verification_token,
        status="pending",
        created_at=now,
        verified_at=None,
    )


async def verify_directory_domain(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    txt_records: Iterable[str],
) -> DirectoryDomainModel | None:
    """Mark a workspace directory domain verified when DNS TXT proof matches."""
    current = await get_directory_domain(conn, org_id)
    normalized_records = {record.strip() for record in txt_records}
    if current is None or current.verification_token not in normalized_records:
        return None
    if current.status == "verified":
        return current

    verified_at = db.now_iso()
    await conn.execute(
        """
        UPDATE org_directory_domains
        SET status = 'verified', verified_at = ?
        WHERE org_id = ?
        """,
        (verified_at, org_id),
    )
    await conn.commit()
    return await get_directory_domain(conn, org_id)


async def get_directory_domain(
    conn: aiosqlite.Connection,
    org_id: str,
) -> DirectoryDomainModel | None:
    """Return the configured directory domain for an org."""
    cursor = await conn.execute(
        """
        SELECT org_id, domain, verification_token, status, created_at, verified_at
        FROM org_directory_domains
        WHERE org_id = ?
        """,
        (org_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return DirectoryDomainModel(
        org_id=row[0],
        domain=row[1],
        verification_token=row[2],
        status=row[3],
        created_at=row[4],
        verified_at=row[5],
    )


async def get_directory_domain_by_domain(
    conn: aiosqlite.Connection,
    domain: str,
) -> DirectoryDomainModel | None:
    """Return the configured directory domain row for a hostname."""
    cursor = await conn.execute(
        """
        SELECT org_id, domain, verification_token, status, created_at, verified_at
        FROM org_directory_domains
        WHERE domain = ?
        """,
        (domain,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return DirectoryDomainModel(
        org_id=row[0],
        domain=row[1],
        verification_token=row[2],
        status=row[3],
        created_at=row[4],
        verified_at=row[5],
    )


async def get_verified_directory_domain(
    conn: aiosqlite.Connection,
    org_id: str,
) -> DirectoryDomainModel | None:
    """Return the verified directory domain for an org, if one exists."""
    domain = await get_directory_domain(conn, org_id)
    if domain is None or domain.status != "verified":
        return None
    return domain
