"""Folding a duplicate profile into the one to keep.

Discovery sometimes lists one actor twice, so a visitor finds two half
profiles and cannot tell which is right. A merge moves everything that
belongs to the actor, from sources and connections to followers and open
reports, off the duplicate and onto the kept profile in one transaction. It
retires the duplicate without deleting it and points the duplicate's address
at the kept profile. The kept profile's own facts do not change; an editor
corrects them through review like any other change.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any

from atlas.domains.moderation.takedowns import EntryTakedownCRUD, TakedownTarget
from atlas.platform.database import db
from atlas.platform.dates import row_timestamp_string

if TYPE_CHECKING:
    import aiosqlite

# Rows keyed by (entry, key) that move unless the kept profile already has
# the same key: one source link, one follow and one saved place per profile.
_KEYED_MOVES: tuple[tuple[str, str], ...] = (
    ("entry_sources", "source_id"),
    ("entry_issue_areas", "issue_area"),
    ("episode_associations", "episode"),
    ("profile_follows", "user_id"),
    ("saved_list_items", "list_id"),
    ("org_coverage_target_entries", "target_id"),
)

# A workspace's own notes about the actor, which follow it to the kept profile.
_REPOINTED_NOTES: tuple[str, ...] = ("outreach_logs", "org_change_events")

_COLUMNS = (
    "id, kept_entry_id, kept_name, kept_slug, duplicate_entry_id, duplicate_name, "
    "duplicate_slug, reason, merged_by, merged_at, moved_json"
)

SAME_PROFILE_BLOCKER = "These are the same profile."
DIFFERENT_KINDS_BLOCKER = "Only two profiles of the same kind can be merged."
BOTH_LINKED_BLOCKER = "Both profiles link an ATProto account, and a profile holds only one."


class MergeBlockedError(Exception):
    """The merge cannot be made; the message says why."""


@dataclass(frozen=True, slots=True)
class MergeCounts:
    """What moves, or moved, from the duplicate to the kept profile."""

    sources: int
    issue_areas: int
    connections: int
    followers: int
    saved_list_places: int
    open_reports: int
    identity_keys: int
    pending_reviews: int


@dataclass(frozen=True, slots=True)
class MergePlan:
    """What merging two profiles would do, and what stops it."""

    keep: TakedownTarget
    duplicate: TakedownTarget
    moves: MergeCounts
    blockers: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EntryMerge:
    """One merge that was made."""

    id: str
    kept_entry_id: str
    kept_name: str
    kept_slug: str | None
    duplicate_entry_id: str
    duplicate_name: str
    duplicate_slug: str | None
    reason: str
    merged_by: str
    merged_at: str
    moved: MergeCounts


def _row_to_merge(row: Any) -> EntryMerge:
    return EntryMerge(
        id=str(row[0]),
        kept_entry_id=str(row[1]),
        kept_name=str(row[2]),
        kept_slug=str(row[3]) if row[3] is not None else None,
        duplicate_entry_id=str(row[4]),
        duplicate_name=str(row[5]),
        duplicate_slug=str(row[6]) if row[6] is not None else None,
        reason=str(row[7]),
        merged_by=str(row[8]),
        merged_at=str(row_timestamp_string(row[9])),
        moved=MergeCounts(**json.loads(str(row[10]))),
    )


async def _count(conn: aiosqlite.Connection, sql: str, params: tuple[str, ...]) -> int:
    cursor = await conn.execute(sql, params)
    row = await cursor.fetchone()
    assert row is not None, "COUNT always returns a row"
    return int(row[0])


def _keyed_condition(table: str, key: str) -> str:
    """Rows on the duplicate whose key the kept profile does not already hold."""
    return (
        f"{table}.entry_id = ? AND NOT EXISTS (SELECT 1 FROM {table} AS kept"
        f" WHERE kept.entry_id = ? AND kept.{key} = {table}.{key})"
    )


def _edge_condition(side: str, other: str) -> str:
    """Edges on one side of the duplicate that do not repeat a kept-profile edge.

    ``side`` and ``other`` name the edge's two entry columns. Edges between the
    two profiles are left out, because merging turns them into a self-loop.
    """
    return (
        f"entity_relationship_edges.{side} = ? AND entity_relationship_edges.{other} <> ?"
        " AND NOT EXISTS (SELECT 1 FROM entity_relationship_edges AS kept"
        f" WHERE kept.{side} = ? AND kept.{other} = entity_relationship_edges.{other}"
        " AND kept.relationship_type = entity_relationship_edges.relationship_type"
        " AND kept.source_id = entity_relationship_edges.source_id)"
    )


class EntryMergeCRUD:
    """Plan merges, make them, and find where a merged profile now lives."""

    @staticmethod
    async def surviving_entry_id(conn: aiosqlite.Connection, entry_id: str) -> str | None:
        """Return the profile a merged duplicate now lives on.

        Follows merges of merges, so a profile merged into one that was later
        merged again resolves to the profile that still stands.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        entry_id : str
            The entry to resolve.

        Returns
        -------
        str | None
            The standing profile's id, or ``None`` when the entry was never
            merged away.
        """
        current = entry_id
        while True:
            cursor = await conn.execute(
                "SELECT kept_entry_id FROM entry_merges WHERE duplicate_entry_id = ?",
                (current,),
            )
            row = await cursor.fetchone()
            if row is None:
                return None if current == entry_id else current
            current = str(row[0])

    @staticmethod
    async def plan(
        conn: aiosqlite.Connection, keep: TakedownTarget, duplicate: TakedownTarget
    ) -> MergePlan:
        """Work out what merging ``duplicate`` into ``keep`` would move and what stops it.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        keep : TakedownTarget
            The profile that stays.
        duplicate : TakedownTarget
            The profile folded into it and retired.

        Returns
        -------
        MergePlan
            The counts that would move and every reason the merge is refused.
        """
        return MergePlan(
            keep=keep,
            duplicate=duplicate,
            moves=await _count_moves(conn, keep.id, duplicate.id),
            blockers=await _blockers(conn, keep, duplicate),
        )

    @staticmethod
    async def merge(
        conn: aiosqlite.Connection,
        keep: TakedownTarget,
        duplicate: TakedownTarget,
        *,
        reason: str,
        merged_by: str,
    ) -> EntryMerge:
        """Fold ``duplicate`` into ``keep`` in one transaction and record why.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        keep : TakedownTarget
            The profile that stays.
        duplicate : TakedownTarget
            The profile folded into it and retired.
        reason : str
            How the editor knows they are the same, kept with the record.
        merged_by : str
            The editor merging them.

        Returns
        -------
        EntryMerge
            The merge, with what moved.

        Raises
        ------
        MergeBlockedError
            When anything stops the merge, including a concurrent merge of the
            same duplicate. Nothing changes in that case.
        """
        blockers = await _blockers(conn, keep, duplicate)
        if blockers:
            raise MergeBlockedError(blockers[0])
        merge_id = db.generate_uuid()
        merged_at = db.now_iso()
        try:
            await _claim_duplicate(
                conn,
                merge_id,
                keep,
                duplicate,
                reason=reason,
                merged_by=merged_by,
                merged_at=merged_at,
            )
            moved, rejected_reviews = await _move_everything(
                conn, keep, duplicate, merged_by=merged_by, merged_at=merged_at
            )
            await conn.execute(
                "UPDATE entry_merges SET moved_json = ? WHERE id = ?",
                (json.dumps(asdict(moved)), merge_id),
            )
            await conn.commit()
        except BaseException:
            await conn.rollback()
            raise
        await _record_rejected_reviews(conn, rejected_reviews, merged_by=merged_by)
        merge = await EntryMergeCRUD.get_by_id(conn, merge_id)
        assert merge is not None, "Merge must exist immediately after it is made"
        return merge

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, merge_id: str) -> EntryMerge | None:
        """Return one merge.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        merge_id : str
            The merge's id.

        Returns
        -------
        EntryMerge | None
            The merge, or ``None``.
        """
        cursor = await conn.execute(
            f"SELECT {_COLUMNS} FROM entry_merges WHERE id = ?", (merge_id,)
        )
        row = await cursor.fetchone()
        return _row_to_merge(row) if row is not None else None

    @staticmethod
    async def list_recent(conn: aiosqlite.Connection, *, limit: int) -> list[EntryMerge]:
        """Return merges, newest first.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        limit : int
            Maximum number to return.

        Returns
        -------
        list[EntryMerge]
            The most recent merges.
        """
        cursor = await conn.execute(
            f"SELECT {_COLUMNS} FROM entry_merges ORDER BY merged_at DESC, id DESC LIMIT ?",
            (limit,),
        )
        return [_row_to_merge(row) for row in await cursor.fetchall()]


async def _claim_duplicate(  # noqa: PLR0913 - the merge record's fields
    conn: aiosqlite.Connection,
    merge_id: str,
    keep: TakedownTarget,
    duplicate: TakedownTarget,
    *,
    reason: str,
    merged_by: str,
    merged_at: str,
) -> None:
    """Record the merge before anything moves, so only one merge of a duplicate wins.

    The duplicate's column is unique, so a concurrent merge of the same
    profile inserts nothing here and is refused before it moves a row.
    """
    claimed = await conn.execute(
        f"""
        INSERT INTO entry_merges ({_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        """,
        (
            merge_id,
            keep.id,
            keep.name,
            keep.slug,
            duplicate.id,
            duplicate.name,
            duplicate.slug,
            reason,
            merged_by,
            merged_at,
            "{}",
        ),
    )
    if claimed.rowcount != 1:
        msg = f"{duplicate.name} was already merged into another profile."
        raise MergeBlockedError(msg)


async def _blockers(
    conn: aiosqlite.Connection, keep: TakedownTarget, duplicate: TakedownTarget
) -> tuple[str, ...]:
    if keep.id == duplicate.id:
        return (SAME_PROFILE_BLOCKER,)
    blockers: list[str] = []
    if keep.type != duplicate.type:
        blockers.append(DIFFERENT_KINDS_BLOCKER)
    for profile in (keep, duplicate):
        if await EntryMergeCRUD.surviving_entry_id(conn, profile.id) is not None:
            blockers.append(f"{profile.name} was already merged into another profile.")
        if await EntryTakedownCRUD.is_taken_down(conn, profile.id):
            blockers.append(f"{profile.name} is taken down. Restore it before merging.")
        if await _is_private(conn, profile.id):
            blockers.append(f"{profile.name} belongs to a workspace, not the public catalog.")
    represented = await _count(
        conn,
        "SELECT COUNT(*) FROM profile_claims WHERE entry_id = ?"
        " AND status IN ('pending', 'verified')",
        (duplicate.id,),
    )
    if represented:
        blockers.append(
            f"{duplicate.name} has a representative or a verification waiting."
            " Merge the other way so they keep their profile."
        )
    linked = await _count(
        conn,
        "SELECT COUNT(DISTINCT entry_id) FROM profile_atproto_links"
        " WHERE entry_id IN (?, ?) AND status <> 'removed'",
        (keep.id, duplicate.id),
    )
    if linked == 2:  # noqa: PLR2004 - both of the two profiles
        blockers.append(BOTH_LINKED_BLOCKER)
    return tuple(blockers)


async def _is_private(conn: aiosqlite.Connection, entry_id: str) -> bool:
    return bool(
        await _count(
            conn,
            "SELECT COUNT(*) FROM resource_ownership WHERE resource_id = ?"
            " AND resource_type = 'entry' AND visibility = 'private'",
            (entry_id,),
        )
    )


async def _count_moves(conn: aiosqlite.Connection, keep_id: str, duplicate_id: str) -> MergeCounts:
    keyed = {
        table: await _count(
            conn,
            f"SELECT COUNT(*) FROM {table} WHERE {_keyed_condition(table, key)}",
            (duplicate_id, keep_id),
        )
        for table, key in _KEYED_MOVES
    }
    edge_params = (duplicate_id, keep_id, keep_id)
    connections = await _count(
        conn,
        "SELECT COUNT(*) FROM entity_relationship_edges WHERE "
        f"({_edge_condition('source_entry_id', 'target_entry_id')})"
        f" OR ({_edge_condition('target_entry_id', 'source_entry_id')})",
        edge_params + edge_params,
    )
    return MergeCounts(
        sources=keyed["entry_sources"],
        issue_areas=keyed["entry_issue_areas"],
        connections=connections,
        followers=keyed["profile_follows"],
        saved_list_places=keyed["saved_list_items"],
        open_reports=await _count(
            conn,
            "SELECT COUNT(*) FROM entity_flags WHERE entity_id = ? AND status = 'open'",
            (duplicate_id,),
        ),
        identity_keys=await _count(
            conn, "SELECT COUNT(*) FROM entity_identity_keys WHERE entry_id = ?", (duplicate_id,)
        ),
        pending_reviews=await _count(
            conn,
            "SELECT COUNT(*) FROM review_queue WHERE entity_id = ? AND status = 'pending'",
            (duplicate_id,),
        ),
    )


async def _move_everything(
    conn: aiosqlite.Connection,
    keep: TakedownTarget,
    duplicate: TakedownTarget,
    *,
    merged_by: str,
    merged_at: str,
) -> tuple[MergeCounts, list[str]]:
    """Move the duplicate's rows onto the kept profile and retire it, uncommitted.

    Returns
    -------
    tuple[MergeCounts, list[str]]
        What moved, and the pending review items closed because their
        profile was merged away.
    """
    keep_id, duplicate_id = keep.id, duplicate.id
    keyed: dict[str, int] = {}
    for table, key in _KEYED_MOVES:
        moved = await conn.execute(
            f"UPDATE {table} SET entry_id = ? WHERE {_keyed_condition(table, key)}",
            (keep_id, duplicate_id, keep_id),
        )
        keyed[table] = moved.rowcount
        await conn.execute(f"DELETE FROM {table} WHERE entry_id = ?", (duplicate_id,))

    await conn.execute(
        "DELETE FROM entity_relationship_edges WHERE (source_entry_id = ? AND target_entry_id = ?)"
        " OR (source_entry_id = ? AND target_entry_id = ?)",
        (duplicate_id, keep_id, keep_id, duplicate_id),
    )
    connections = 0
    for side, other in (
        ("source_entry_id", "target_entry_id"),
        ("target_entry_id", "source_entry_id"),
    ):
        moved = await conn.execute(
            f"UPDATE entity_relationship_edges SET {side} = ? WHERE {_edge_condition(side, other)}",
            (keep_id, duplicate_id, keep_id, keep_id),
        )
        connections += moved.rowcount
        await conn.execute(
            f"DELETE FROM entity_relationship_edges WHERE {side} = ?", (duplicate_id,)
        )

    identity_keys = await conn.execute(
        "UPDATE entity_identity_keys SET entry_id = ? WHERE entry_id = ?", (keep_id, duplicate_id)
    )
    open_reports = await conn.execute(
        "UPDATE entity_flags SET entity_id = ? WHERE entity_id = ? AND status = 'open'",
        (keep_id, duplicate_id),
    )
    cursor = await conn.execute(
        "SELECT id FROM review_queue WHERE entity_id = ? AND status = 'pending'", (duplicate_id,)
    )
    rejected_reviews = [str(row[0]) for row in await cursor.fetchall()]
    await conn.execute(
        "UPDATE review_queue SET status = 'rejected', reviewed_at = ?, reviewed_by = ?"
        " WHERE entity_id = ? AND status = 'pending'",
        (merged_at, merged_by, duplicate_id),
    )
    await conn.execute(
        "UPDATE profile_atproto_links SET entry_id = ? WHERE entry_id = ? AND status <> 'removed'",
        (keep_id, duplicate_id),
    )
    for table in _REPOINTED_NOTES:
        await conn.execute(
            f"UPDATE {table} SET entry_id = ? WHERE entry_id = ?", (keep_id, duplicate_id)
        )
    await conn.execute(
        "UPDATE org_annotations SET entry_id = ? WHERE entry_id = ?", (keep_id, duplicate_id)
    )
    await conn.execute(
        "UPDATE org_annotations SET target_id = ? WHERE target_type = 'entry' AND target_id = ?",
        (keep_id, duplicate_id),
    )
    # An organization whose parent was the duplicate would become its own parent.
    await conn.execute(
        "UPDATE entries SET affiliated_org_id = NULL WHERE id = ? AND affiliated_org_id = ?",
        (keep_id, duplicate_id),
    )
    await conn.execute(
        "UPDATE entries SET affiliated_org_id = ? WHERE affiliated_org_id = ?",
        (keep_id, duplicate_id),
    )
    await conn.execute(
        "UPDATE slug_aliases SET entry_id = ? WHERE entry_id = ?", (keep_id, duplicate_id)
    )
    if duplicate.slug is not None:
        await conn.execute(
            """
            INSERT INTO slug_aliases (old_slug, entry_id, created_at) VALUES (?, ?, ?)
            ON CONFLICT (old_slug) DO UPDATE SET entry_id = excluded.entry_id
            """,
            (duplicate.slug, keep_id, merged_at),
        )
    await conn.execute(
        "UPDATE entries SET active = FALSE, updated_at = ? WHERE id = ?",
        (merged_at, duplicate_id),
    )
    return (
        MergeCounts(
            sources=keyed["entry_sources"],
            issue_areas=keyed["entry_issue_areas"],
            connections=connections,
            followers=keyed["profile_follows"],
            saved_list_places=keyed["saved_list_items"],
            open_reports=open_reports.rowcount,
            identity_keys=identity_keys.rowcount,
            pending_reviews=len(rejected_reviews),
        ),
        rejected_reviews,
    )


async def _record_rejected_reviews(
    conn: aiosqlite.Connection, review_item_ids: list[str], *, merged_by: str
) -> None:
    """Tell the firehose about review items the merge closed, as a rejection would."""
    from atlas.domains.firehose.producers import record_review_decision_observation

    for review_item_id in review_item_ids:
        await record_review_decision_observation(
            conn, review_item_id=review_item_id, status="rejected", reviewed_by=merged_by
        )
