"""
Source model and CRUD operations.

Sources represent web articles, documents, and other content that entries
are extracted from and linked to.
"""

import logging
from dataclasses import dataclass
from datetime import date
from typing import Any

import aiosqlite

from atlas.models.database import db

logger = logging.getLogger(__name__)

__all__ = ["SourceCRUD", "SourceModel"]


@dataclass
class SourceModel:
    """Source data model."""

    id: str
    url: str
    title: str | None
    publication: str | None
    published_date: date | None
    type: str
    ingested_at: str
    extraction_method: str
    raw_content: str | None
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        """
        Convert source to dictionary.

        Returns
        -------
        dict[str, Any]
            Source as dictionary.
        """
        return {
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "publication": self.publication,
            "published_date": self.published_date.isoformat() if self.published_date else None,
            "type": self.type,
            "ingested_at": self.ingested_at,
            "extraction_method": self.extraction_method,
            "raw_content": self.raw_content,
            "created_at": self.created_at,
        }


class SourceCRUD:
    """CRUD operations for sources."""

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        url: str,
        source_type: str,
        extraction_method: str,
        title: str | None = None,
        publication: str | None = None,
        published_date: date | None = None,
        raw_content: str | None = None,
    ) -> str:
        """
        Create a new source.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        url : str
            Source URL (must be unique).
        source_type : str
            Source type (news_article, op_ed, podcast, academic_paper, etc.).
        extraction_method : str
            How the source was extracted (manual, ai_assisted, autodiscovery).
        title : str | None, optional
            Source title. Default is None.
        publication : str | None, optional
            Publication name. Default is None.
        published_date : date | None, optional
            Publication date. Default is None.
        raw_content : str | None, optional
            Raw HTML/text content for re-extraction. Default is None.

        Returns
        -------
        str
            The created source ID.

        Raises
        ------
        aiosqlite.IntegrityError
            If URL already exists.
        """
        source_id = db.generate_uuid()
        now = db.now_iso()

        await conn.execute(
            """
            INSERT INTO sources (
                id, url, title, publication, published_date, type,
                ingested_at, extraction_method, raw_content, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_id,
                url,
                title,
                publication,
                published_date.isoformat() if published_date else None,
                source_type,
                now,
                extraction_method,
                raw_content,
                now,
            ),
        )
        await conn.commit()
        return source_id

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, source_id: str) -> SourceModel | None:
        """
        Get a source by ID.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        source_id : str
            Source ID.

        Returns
        -------
        SourceModel | None
            The source if found, None otherwise.
        """
        cursor = await conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        data = dict(zip(columns, row, strict=False))
        return _row_to_source(data)

    @staticmethod
    async def get_by_url(conn: aiosqlite.Connection, url: str) -> SourceModel | None:
        """
        Get a source by URL.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        url : str
            Source URL.

        Returns
        -------
        SourceModel | None
            The source if found, None otherwise.
        """
        cursor = await conn.execute("SELECT * FROM sources WHERE url = ?", (url,))
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        data = dict(zip(columns, row, strict=False))
        return _row_to_source(data)

    @staticmethod
    async def list(
        conn: aiosqlite.Connection,
        source_type: str | None = None,
        extraction_method: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[SourceModel]:
        """
        List sources with optional filtering.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        source_type : str | None, optional
            Filter by type. Default is None.
        extraction_method : str | None, optional
            Filter by extraction method. Default is None.
        limit : int, optional
            Result limit. Default is 100.
        offset : int, optional
            Result offset. Default is 0.

        Returns
        -------
        list[SourceModel]
            List of sources.
        """
        query = "SELECT * FROM sources WHERE 1=1"
        params: list[Any] = []

        if source_type:
            query += " AND type = ?"
            params.append(source_type)
        if extraction_method:
            query += " AND extraction_method = ?"
            params.append(extraction_method)

        query += " ORDER BY ingested_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()

        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        return [_row_to_source(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        source_id: str,
        **kwargs: object,
    ) -> bool:
        """
        Update a source.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        source_id : str
            Source ID.
        **kwargs : object
            Fields to update.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        allowed_fields = {"title", "publication", "published_date", "raw_content"}

        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), source_id]

        cursor = await conn.execute(
            f"UPDATE sources SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def delete(conn: aiosqlite.Connection, source_id: str) -> bool:
        """
        Delete a source.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        source_id : str
            Source ID.

        Returns
        -------
        bool
            True if deleted, False if not found.
        """
        cursor = await conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def link_to_entry(
        conn: aiosqlite.Connection,
        entry_id: str,
        source_id: str,
        extraction_context: str | None = None,
    ) -> None:
        """
        Link an entry to a source.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.
        source_id : str
            Source ID.
        extraction_context : str | None, optional
            The passage that supported extraction. Default is None.
        """
        await conn.execute(
            """
            INSERT OR REPLACE INTO entry_sources (entry_id, source_id, extraction_context, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (entry_id, source_id, extraction_context, db.now_iso()),
        )
        await conn.commit()

    @staticmethod
    async def unlink_from_entry(conn: aiosqlite.Connection, entry_id: str, source_id: str) -> bool:
        """
        Remove link between an entry and source.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            Entry ID.
        source_id : str
            Source ID.

        Returns
        -------
        bool
            True if unlinked, False if no link existed.
        """
        cursor = await conn.execute(
            "DELETE FROM entry_sources WHERE entry_id = ? AND source_id = ?",
            (entry_id, source_id),
        )
        await conn.commit()
        return cursor.rowcount > 0


def _row_to_source(row: dict[str, Any]) -> SourceModel:
    """Convert database row to SourceModel."""
    return SourceModel(
        id=row["id"],
        url=row["url"],
        title=row["title"],
        publication=row["publication"],
        published_date=date.fromisoformat(row["published_date"]) if row["published_date"] else None,
        type=row["type"],
        ingested_at=row["ingested_at"],
        extraction_method=row["extraction_method"],
        raw_content=row["raw_content"],
        created_at=row["created_at"],
    )
