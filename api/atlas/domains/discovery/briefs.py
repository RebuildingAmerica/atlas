"""Workspace Atlas Brief artifact models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

__all__ = ["OrgBriefCRUD", "OrgBriefModel"]


class StoredBriefDecodeError(TypeError):
    """Raised when persisted brief JSON has an unexpected shape."""


@dataclass
class OrgBriefModel:
    """Private Atlas Brief artifact stored inside one workspace."""

    id: str
    org_id: str
    title: str
    scope: dict[str, Any]
    summary: str
    linked_entry_ids: list[str]
    linked_source_ids: list[str]
    linked_discovery_run_ids: list[str]
    confidence_summary: dict[str, Any]
    gaps: list[dict[str, Any]]
    created_by: str
    created_at: str
    updated_at: str


def _decode_json_object(value: str) -> dict[str, Any]:
    """Decode a stored JSON object.

    Parameters
    ----------
    value
        JSON-encoded object.

    Returns
    -------
    dict[str, Any]
        Decoded mapping.
    """
    decoded = db.decode_json(value)
    if not isinstance(decoded, dict):
        raise StoredBriefDecodeError
    return decoded


def _decode_json_string_list(value: str) -> list[str]:
    """Decode a stored JSON list of strings.

    Parameters
    ----------
    value
        JSON-encoded list.

    Returns
    -------
    list[str]
        Decoded strings.
    """
    decoded = db.decode_json(value)
    if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
        raise StoredBriefDecodeError
    return decoded


def _decode_json_object_list(value: str) -> list[dict[str, Any]]:
    """Decode a stored JSON list of objects.

    Parameters
    ----------
    value
        JSON-encoded list.

    Returns
    -------
    list[dict[str, Any]]
        Decoded mappings.
    """
    decoded = db.decode_json(value)
    if not isinstance(decoded, list) or not all(isinstance(item, dict) for item in decoded):
        raise StoredBriefDecodeError
    return decoded


def _row_to_org_brief(row: Any) -> OrgBriefModel:
    """Convert a database row into an OrgBriefModel.

    Parameters
    ----------
    row
        Row selected from ``org_briefs``.

    Returns
    -------
    OrgBriefModel
        Decoded brief model.
    """
    return OrgBriefModel(
        id=str(row[0]),
        org_id=str(row[1]),
        title=str(row[2]),
        scope=_decode_json_object(str(row[3])),
        summary=str(row[4]),
        linked_entry_ids=_decode_json_string_list(str(row[5])),
        linked_source_ids=_decode_json_string_list(str(row[6])),
        linked_discovery_run_ids=_decode_json_string_list(str(row[7])),
        confidence_summary=_decode_json_object(str(row[8])),
        gaps=_decode_json_object_list(str(row[9])),
        created_by=str(row[10]),
        created_at=str(row[11]),
        updated_at=str(row[12]),
    )


class OrgBriefCRUD:
    """CRUD operations for private workspace Atlas Brief artifacts."""

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        title: str,
        scope: dict[str, Any],
        summary: str,
        linked_entry_ids: list[str],
        linked_source_ids: list[str],
        linked_discovery_run_ids: list[str],
        confidence_summary: dict[str, Any],
        gaps: list[dict[str, Any]],
        created_by: str,
    ) -> OrgBriefModel:
        """Create a private Atlas Brief artifact.

        Parameters
        ----------
        conn
            Database connection.
        org_id
            Workspace that owns the brief.
        title
            Brief title shown to workspace users.
        scope
            Explicit research scope for the brief.
        summary
            Human-readable source-linked summary.
        linked_entry_ids
            Entry IDs used by the brief.
        linked_source_ids
            Source IDs used by the brief.
        linked_discovery_run_ids
            Discovery run IDs used by the brief.
        confidence_summary
            Trust summary for the brief.
        gaps
            Known gaps or unknowns represented in the brief.
        created_by
            User ID that created the brief.

        Returns
        -------
        OrgBriefModel
            Created brief.
        """
        brief_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO org_briefs (
                id, org_id, title, scope_json, summary,
                linked_entry_ids_json, linked_source_ids_json, linked_discovery_run_ids_json,
                confidence_summary_json, gaps_json, created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                brief_id,
                org_id,
                title,
                db.encode_json(scope),
                summary,
                db.encode_json(linked_entry_ids),
                db.encode_json(linked_source_ids),
                db.encode_json(linked_discovery_run_ids),
                db.encode_json(confidence_summary),
                db.encode_json(gaps),
                created_by,
                now,
                now,
            ),
        )
        await conn.commit()
        created = await OrgBriefCRUD.get(conn, brief_id)
        assert created is not None, "brief was just inserted"
        return created

    @staticmethod
    async def get(conn: aiosqlite.Connection, brief_id: str) -> OrgBriefModel | None:
        """Get one private Atlas Brief artifact.

        Parameters
        ----------
        conn
            Database connection.
        brief_id
            Brief ID.

        Returns
        -------
        OrgBriefModel | None
            Brief when found.
        """
        cursor = await conn.execute(
            """
            SELECT
                id, org_id, title, scope_json, summary,
                linked_entry_ids_json, linked_source_ids_json, linked_discovery_run_ids_json,
                confidence_summary_json, gaps_json, created_by, created_at, updated_at
            FROM org_briefs
            WHERE id = ?
            """,
            (brief_id,),
        )
        row = await cursor.fetchone()
        return _row_to_org_brief(row) if row is not None else None

    @staticmethod
    async def update(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        brief_id: str,
        *,
        title: str | None = None,
        summary: str | None = None,
        confidence_summary: dict[str, Any] | None = None,
        gaps: list[dict[str, Any]] | None = None,
    ) -> OrgBriefModel | None:
        """Update editable memo fields on a private Atlas Brief.

        Parameters
        ----------
        conn
            Database connection.
        brief_id
            Brief ID.
        title
            Updated brief title.
        summary
            Updated brief summary.
        confidence_summary
            Updated trust summary.
        gaps
            Updated known gaps.

        Returns
        -------
        OrgBriefModel | None
            Updated brief, or ``None`` when the brief is missing.
        """
        fields: dict[str, Any] = {}
        if title is not None:
            fields["title"] = title
        if summary is not None:
            fields["summary"] = summary
        if confidence_summary is not None:
            fields["confidence_summary_json"] = db.encode_json(confidence_summary)
        if gaps is not None:
            fields["gaps_json"] = db.encode_json(gaps)

        if not fields:
            return await OrgBriefCRUD.get(conn, brief_id)

        fields["updated_at"] = db.now_iso()
        set_clause = ", ".join(f"{field} = ?" for field in fields)
        cursor = await conn.execute(
            f"UPDATE org_briefs SET {set_clause} WHERE id = ?",
            [*fields.values(), brief_id],
        )
        await conn.commit()
        if cursor.rowcount == 0:
            return None
        return await OrgBriefCRUD.get(conn, brief_id)

    @staticmethod
    async def list_by_org(conn: aiosqlite.Connection, org_id: str) -> list[OrgBriefModel]:
        """List private Atlas Brief artifacts for one workspace.

        Parameters
        ----------
        conn
            Database connection.
        org_id
            Workspace ID.

        Returns
        -------
        list[OrgBriefModel]
            Briefs sorted by most recent update.
        """
        cursor = await conn.execute(
            """
            SELECT
                id, org_id, title, scope_json, summary,
                linked_entry_ids_json, linked_source_ids_json, linked_discovery_run_ids_json,
                confidence_summary_json, gaps_json, created_by, created_at, updated_at
            FROM org_briefs
            WHERE org_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            (org_id,),
        )
        rows = await cursor.fetchall()
        return [_row_to_org_brief(row) for row in rows]
