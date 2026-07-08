"""Directory metadata persistence helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .ownership_models import DirectoryConfigModel, PublicDirectoryIndexModel, _decode_string_list

if TYPE_CHECKING:
    import aiosqlite


async def upsert_directory_config(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    title: str | None,
    sponsor_label: str | None,
    issue_area_ids: list[str],
    geography_labels: list[str],
    entry_types: list[str],
    methodology_summary: str | None,
    source_policy: str | None,
    review_policy: str | None,
    correction_policy: str | None,
    correction_path_template: str | None,
    missing_context_path_template: str | None,
    actor_id: str,
) -> DirectoryConfigModel:
    """Create or replace public metadata for a workspace directory."""
    now = db.now_iso()
    await conn.execute(
        """
        INSERT INTO org_directory_configs (
            org_id,
            title,
            sponsor_label,
            issue_area_ids_json,
            geography_labels_json,
            entry_types_json,
            methodology_summary,
            source_policy,
            review_policy,
            correction_policy,
            correction_path_template,
            missing_context_path_template,
            created_by,
            updated_by,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id) DO UPDATE SET
            title = excluded.title,
            sponsor_label = excluded.sponsor_label,
            issue_area_ids_json = excluded.issue_area_ids_json,
            geography_labels_json = excluded.geography_labels_json,
            entry_types_json = excluded.entry_types_json,
            methodology_summary = excluded.methodology_summary,
            source_policy = excluded.source_policy,
            review_policy = excluded.review_policy,
            correction_policy = excluded.correction_policy,
            correction_path_template = excluded.correction_path_template,
            missing_context_path_template = excluded.missing_context_path_template,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        """,
        (
            org_id,
            title,
            sponsor_label,
            db.encode_json(issue_area_ids),
            db.encode_json(geography_labels),
            db.encode_json(entry_types),
            methodology_summary,
            source_policy,
            review_policy,
            correction_policy,
            correction_path_template,
            missing_context_path_template,
            actor_id,
            actor_id,
            now,
            now,
        ),
    )
    await conn.commit()
    config = await get_directory_config(conn, org_id)
    assert config is not None, "Directory config upsert must return the persisted row"
    return config


async def get_directory_config(
    conn: aiosqlite.Connection,
    org_id: str,
) -> DirectoryConfigModel | None:
    """Return editable public metadata for a workspace directory."""
    cursor = await conn.execute(
        """
        SELECT
            org_id,
            title,
            sponsor_label,
            issue_area_ids_json,
            geography_labels_json,
            entry_types_json,
            methodology_summary,
            source_policy,
            review_policy,
            correction_policy,
            correction_path_template,
            missing_context_path_template,
            created_by,
            updated_by,
            created_at,
            updated_at
        FROM org_directory_configs
        WHERE org_id = ?
        """,
        (org_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return DirectoryConfigModel(
        org_id=row[0],
        title=row[1],
        sponsor_label=row[2],
        issue_area_ids=_decode_string_list(row[3], "issue_area_ids_json"),
        geography_labels=_decode_string_list(row[4], "geography_labels_json"),
        entry_types=_decode_string_list(row[5], "entry_types_json"),
        methodology_summary=row[6],
        source_policy=row[7],
        review_policy=row[8],
        correction_policy=row[9],
        correction_path_template=row[10],
        missing_context_path_template=row[11],
        created_by=row[12],
        updated_by=row[13],
        created_at=row[14],
        updated_at=row[15],
    )


async def list_public_directory_index(
    conn: aiosqlite.Connection,
) -> list[PublicDirectoryIndexModel]:
    """List org directories that have at least one public published entry."""
    cursor = await conn.execute(
        """
        SELECT
            ownership.org_id,
            COUNT(*) AS record_count,
            MAX(ownership.created_at) AS last_published_at
        FROM resource_ownership AS ownership
        INNER JOIN entries ON entries.id = ownership.resource_id
        WHERE ownership.resource_type = 'entry'
          AND ownership.visibility = 'public'
        GROUP BY ownership.org_id
        HAVING COUNT(*) > 0
        ORDER BY ownership.org_id
        """
    )
    rows = await cursor.fetchall()
    return [
        PublicDirectoryIndexModel(
            org_id=row[0],
            record_count=row[1],
            last_published_at=row[2],
        )
        for row in rows
    ]
