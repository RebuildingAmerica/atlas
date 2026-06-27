"""Resource ownership and organization annotation models."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["AnnotationModel", "DirectoryDomainModel", "OwnershipCRUD", "OwnershipModel"]


class AnnotationTargetError(ValueError):
    """Raised when a private note target is missing or ambiguous."""


@dataclass
class OwnershipModel:
    """Resource ownership record."""

    resource_id: str
    resource_type: str
    org_id: str
    visibility: str
    created_by: str
    created_at: str


@dataclass
class AnnotationModel:
    """Organization annotation on a shared entry or source."""

    id: str
    org_id: str
    entry_id: str | None
    source_id: str | None
    target_type: str
    target_id: str
    content: str
    author_id: str
    created_at: str
    updated_at: str


@dataclass
class DirectoryDomainModel:
    """Custom domain ownership record for a public workspace directory."""

    org_id: str
    domain: str
    verification_token: str
    status: str
    created_at: str
    verified_at: str | None


class OwnershipCRUD:
    """CRUD operations for resource ownership and annotations."""

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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
        return await OwnershipCRUD.get_ownership(conn, resource_id, resource_type)

    @staticmethod
    async def upsert_directory_domain(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        domain: str,
    ) -> DirectoryDomainModel:
        """Create or replace the verification token for a workspace directory domain."""
        normalized_domain = domain.strip().lower()
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

    @staticmethod
    async def verify_directory_domain(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        txt_record: str,
    ) -> DirectoryDomainModel | None:
        """Mark a workspace directory domain verified when the TXT proof matches."""
        current = await OwnershipCRUD.get_directory_domain(conn, org_id)
        if current is None or current.verification_token != txt_record.strip():
            return None

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
        return await OwnershipCRUD.get_directory_domain(conn, org_id)

    @staticmethod
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

    @staticmethod
    async def get_verified_directory_domain(
        conn: aiosqlite.Connection,
        org_id: str,
    ) -> DirectoryDomainModel | None:
        """Return the verified directory domain for an org, if one exists."""
        domain = await OwnershipCRUD.get_directory_domain(conn, org_id)
        if domain is None or domain.status != "verified":
            return None
        return domain

    @staticmethod
    async def create_annotation(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        entry_id: str | None = None,
        source_id: str | None = None,
        content: str,
        author_id: str,
    ) -> AnnotationModel:
        """Create an annotation on a shared entry or source."""
        if (entry_id is None) == (source_id is None):
            raise AnnotationTargetError
        if entry_id is not None:
            target_type = "entry"
            target_id = entry_id
        else:
            assert source_id is not None
            target_type = "source"
            target_id = source_id
        annotation_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """INSERT INTO org_annotations
               (
                   id, org_id, entry_id, source_id, target_type, target_id,
                   content, author_id, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                annotation_id,
                org_id,
                entry_id,
                source_id,
                target_type,
                target_id,
                content,
                author_id,
                now,
                now,
            ),
        )
        await conn.commit()
        return AnnotationModel(
            id=annotation_id,
            org_id=org_id,
            entry_id=entry_id,
            source_id=source_id,
            target_type=target_type,
            target_id=target_id,
            content=content,
            author_id=author_id,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    async def list_annotations(
        conn: aiosqlite.Connection,
        org_id: str,
        entry_id: str | None = None,
        source_id: str | None = None,
    ) -> list[AnnotationModel]:
        """List annotations for an org, optionally filtered by entry or source."""
        if entry_id and source_id:
            raise AnnotationTargetError
        if entry_id:
            cursor = await conn.execute(
                """SELECT
                       id, org_id, entry_id, source_id, target_type, target_id,
                       content, author_id, created_at, updated_at
                   FROM org_annotations
                   WHERE org_id = ? AND entry_id = ?
                   ORDER BY created_at DESC""",
                (org_id, entry_id),
            )
        elif source_id:
            cursor = await conn.execute(
                """SELECT
                       id, org_id, entry_id, source_id, target_type, target_id,
                       content, author_id, created_at, updated_at
                   FROM org_annotations
                   WHERE org_id = ? AND source_id = ?
                   ORDER BY created_at DESC""",
                (org_id, source_id),
            )
        else:
            cursor = await conn.execute(
                """SELECT
                       id, org_id, entry_id, source_id, target_type, target_id,
                       content, author_id, created_at, updated_at
                   FROM org_annotations
                   WHERE org_id = ?
                   ORDER BY created_at DESC""",
                (org_id,),
            )
        rows = await cursor.fetchall()
        return [
            AnnotationModel(
                id=r[0],
                org_id=r[1],
                entry_id=r[2],
                source_id=r[3],
                target_type=r[4],
                target_id=r[5],
                content=r[6],
                author_id=r[7],
                created_at=r[8],
                updated_at=r[9],
            )
            for r in rows
        ]

    @staticmethod
    async def get_annotation(
        conn: aiosqlite.Connection,
        annotation_id: str,
    ) -> AnnotationModel | None:
        """Get a single annotation by ID."""
        cursor = await conn.execute(
            """SELECT
                   id, org_id, entry_id, source_id, target_type, target_id,
                   content, author_id, created_at, updated_at
               FROM org_annotations
               WHERE id = ?""",
            (annotation_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return AnnotationModel(
            id=row[0],
            org_id=row[1],
            entry_id=row[2],
            source_id=row[3],
            target_type=row[4],
            target_id=row[5],
            content=row[6],
            author_id=row[7],
            created_at=row[8],
            updated_at=row[9],
        )

    @staticmethod
    async def update_annotation(
        conn: aiosqlite.Connection,
        annotation_id: str,
        content: str,
    ) -> AnnotationModel | None:
        """Update an annotation's content."""
        now = db.now_iso()
        await conn.execute(
            """UPDATE org_annotations SET content = ?, updated_at = ? WHERE id = ?""",
            (content, now, annotation_id),
        )
        await conn.commit()
        return await OwnershipCRUD.get_annotation(conn, annotation_id)

    @staticmethod
    async def delete_annotation(
        conn: aiosqlite.Connection,
        annotation_id: str,
    ) -> bool:
        """Delete an annotation. Returns True if deleted."""
        cursor = await conn.execute(
            """DELETE FROM org_annotations WHERE id = ?""",
            (annotation_id,),
        )
        await conn.commit()
        return cursor.rowcount > 0
