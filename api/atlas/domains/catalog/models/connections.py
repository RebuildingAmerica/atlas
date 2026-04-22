"""
Connection computation for related actor discovery.

Computes four relationship types from existing data:
- Same organization: actors sharing an affiliated_org_id
- Co-mentioned: actors linked to the same source
- Same issue area: actors with overlapping issue tags in the same state
- Same geography: actors in the same city
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry import EntryCRUD, _row_to_entry

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.catalog.models.entry import EntryModel

MAX_ACTORS_PER_GROUP = 10


async def compute_connections(conn: aiosqlite.Connection, entry_id: str) -> list[dict[str, Any]]:
    """Compute related actors for an entry, grouped by relationship type.

    Checks four relationship dimensions: organizational affiliation,
    source co-mentions, issue-area overlap within the same state, and
    geographic co-location. Empty groups are omitted from the result.

    Parameters
    ----------
    conn : aiosqlite.Connection
        Database connection.
    entry_id : str
        The entry whose connections to compute.

    Returns
    -------
    list[dict[str, Any]]
        A list of connection groups. Each group has ``type`` (str) and
        ``actors`` (list of dicts with id, name, type, slug,
        description_snippet, and evidence).
    """
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    if entry is None:
        return []

    groups: list[dict[str, Any]] = []

    same_org_actors = await _find_same_organization(conn, entry)
    if same_org_actors:
        groups.append({"type": "same_organization", "actors": same_org_actors})

    co_mentioned_actors = await _find_co_mentioned(conn, entry_id)
    if co_mentioned_actors:
        groups.append({"type": "co_mentioned", "actors": co_mentioned_actors})

    same_issue_actors = await _find_same_issue_area(conn, entry)
    if same_issue_actors:
        groups.append({"type": "same_issue_area", "actors": same_issue_actors})

    same_geo_actors = await _find_same_geography(conn, entry)
    if same_geo_actors:
        groups.append({"type": "same_geography", "actors": same_geo_actors})

    return groups


def _actor_dict(entry: EntryModel, evidence: str) -> dict[str, Any]:
    """Build a connection actor dict from an EntryModel."""
    return {
        "id": entry.id,
        "name": entry.name,
        "type": entry.type,
        "slug": entry.slug,
        "description_snippet": (entry.description or "")[:120] or None,
        "evidence": evidence,
    }


async def _find_same_organization(
    conn: aiosqlite.Connection, entry: EntryModel
) -> list[dict[str, Any]]:
    """Find actors affiliated with the same organization."""
    actors: list[dict[str, Any]] = []

    if entry.type == "person" and entry.affiliated_org_id:
        org = await EntryCRUD.get_by_id(conn, entry.affiliated_org_id)
        if org:
            actors.append(_actor_dict(org, "Affiliated organization"))

        cursor = await conn.execute(
            "SELECT * FROM entries WHERE affiliated_org_id = ? AND id != ? AND active = 1 LIMIT ?",
            (entry.affiliated_org_id, entry.id, MAX_ACTORS_PER_GROUP),
        )
        rows = await cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        for row in rows:
            other = _row_to_entry(dict(zip(columns, row, strict=False)))
            evidence = f"Also affiliated with {org.name}" if org else "Same organization"
            actors.append(_actor_dict(other, evidence))

    elif entry.type == "organization":
        cursor = await conn.execute(
            "SELECT * FROM entries WHERE affiliated_org_id = ? AND active = 1 LIMIT ?",
            (entry.id, MAX_ACTORS_PER_GROUP),
        )
        rows = await cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        for row in rows:
            person = _row_to_entry(dict(zip(columns, row, strict=False)))
            actors.append(_actor_dict(person, f"Affiliated with {entry.name}"))

    return actors


async def _find_co_mentioned(conn: aiosqlite.Connection, entry_id: str) -> list[dict[str, Any]]:
    """Find actors co-mentioned in the same sources."""
    cursor = await conn.execute(
        """
        SELECT DISTINCT e.*, s.title AS source_title, s.publication AS source_publication
        FROM entries e
        JOIN entry_sources es1 ON es1.entry_id = e.id
        JOIN entry_sources es2 ON es2.source_id = es1.source_id
        JOIN sources s ON s.id = es1.source_id
        WHERE es2.entry_id = ? AND e.id != ? AND e.active = 1
        LIMIT ?
        """,
        (entry_id, entry_id, MAX_ACTORS_PER_GROUP),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []

    columns = [desc[0] for desc in cursor.description]
    actors: list[dict[str, Any]] = []
    for row in rows:
        row_dict = dict(zip(columns, row, strict=False))
        other = _row_to_entry(row_dict)
        source_pub = row_dict.get("source_publication", "")
        source_title = row_dict.get("source_title", "")
        evidence = (
            f"Both mentioned in: {source_pub}" if source_pub else f"Co-mentioned in: {source_title}"
        )
        actors.append(_actor_dict(other, evidence))

    return actors


async def _find_same_issue_area(
    conn: aiosqlite.Connection, entry: EntryModel
) -> list[dict[str, Any]]:
    """Find actors with overlapping issue areas in the same state."""
    issue_areas = await EntryCRUD.get_issue_areas(conn, entry.id)
    if not issue_areas or not entry.state:
        return []

    placeholders = ", ".join("?" for _ in issue_areas)
    cursor = await conn.execute(
        f"""
        SELECT DISTINCT e.*
        FROM entries e
        JOIN entry_issue_areas eia ON eia.entry_id = e.id
        WHERE eia.issue_area IN ({placeholders})
        AND e.state = ?
        AND e.id != ?
        AND e.active = 1
        LIMIT ?
        """,
        (*issue_areas, entry.state, entry.id, MAX_ACTORS_PER_GROUP),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []

    columns = [desc[0] for desc in cursor.description]
    return [
        _actor_dict(
            _row_to_entry(dict(zip(columns, row, strict=False))),
            f"Shares issue areas in {entry.state}",
        )
        for row in rows
    ]


async def _find_same_geography(
    conn: aiosqlite.Connection, entry: EntryModel
) -> list[dict[str, Any]]:
    """Find actors in the same city working on different issues."""
    if not entry.city:
        return []

    cursor = await conn.execute(
        """
        SELECT * FROM entries
        WHERE city = ? AND state = ? AND id != ? AND active = 1
        LIMIT ?
        """,
        (entry.city, entry.state, entry.id, MAX_ACTORS_PER_GROUP),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []

    columns = [desc[0] for desc in cursor.description]
    return [
        _actor_dict(
            _row_to_entry(dict(zip(columns, row, strict=False))),
            f"Active in {entry.city}, {entry.state}",
        )
        for row in rows
    ]
