"""Annotation persistence helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .ownership_models import AnnotationModel, AnnotationTargetError

if TYPE_CHECKING:
    import aiosqlite


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
    return await get_annotation(conn, annotation_id)


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
