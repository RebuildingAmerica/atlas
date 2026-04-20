"""Resource ownership and organization annotation models."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

__all__ = ["AnnotationModel", "OwnershipCRUD", "OwnershipModel"]


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
    """Organization annotation on a shared entry."""

    id: str
    org_id: str
    entry_id: str
    content: str
    author_id: str
    created_at: str
    updated_at: str


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
    async def create_annotation(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        entry_id: str,
        content: str,
        author_id: str,
    ) -> AnnotationModel:
        """Create an annotation on a shared entry."""
        annotation_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """INSERT INTO org_annotations
               (id, org_id, entry_id, content, author_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (annotation_id, org_id, entry_id, content, author_id, now, now),
        )
        await conn.commit()
        return AnnotationModel(
            id=annotation_id,
            org_id=org_id,
            entry_id=entry_id,
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
    ) -> list[AnnotationModel]:
        """List annotations for an org, optionally filtered by entry."""
        if entry_id:
            cursor = await conn.execute(
                """SELECT id, org_id, entry_id, content, author_id, created_at, updated_at
                   FROM org_annotations
                   WHERE org_id = ? AND entry_id = ?
                   ORDER BY created_at DESC""",
                (org_id, entry_id),
            )
        else:
            cursor = await conn.execute(
                """SELECT id, org_id, entry_id, content, author_id, created_at, updated_at
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
                content=r[3],
                author_id=r[4],
                created_at=r[5],
                updated_at=r[6],
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
            """SELECT id, org_id, entry_id, content, author_id, created_at, updated_at
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
            content=row[3],
            author_id=row[4],
            created_at=row[5],
            updated_at=row[6],
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
