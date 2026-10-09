"""Profile merges as production PostgreSQL runs them."""

from __future__ import annotations

import psycopg
import pytest

from atlas.domains.access.models.follows import FollowCRUD
from atlas.domains.moderation import merges as merges_module
from atlas.domains.moderation.merges import EntryMergeCRUD, MergeBlockedError
from atlas.domains.moderation.takedowns import EntryTakedownCRUD, TakedownTarget
from atlas.models import EntryCRUD, SourceCRUD, init_db
from atlas.models.database import get_db_connection


async def _org(conn: object, name: str) -> TakedownTarget:
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name=name,
        description=f"{name} organizes renters.",
        city="Reno",
        state="NV",
        geo_specificity="local",
    )
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    assert entry is not None
    assert entry.slug is not None
    target = await EntryTakedownCRUD.find_target(conn, entry.slug)
    assert target is not None
    return target


@pytest.mark.asyncio
async def test_postgres_merges_in_one_transaction_and_keeps_the_duplicate_retired(
    postgres_database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rows move unless already present, the alias redirects, and a lost race moves nothing."""
    await init_db(postgres_database_url)
    conn = await get_db_connection(postgres_database_url, backend="postgres")
    try:
        keep = await _org(conn, "Reno Tenants Union")
        duplicate = await _org(conn, "Reno Tenants")
        other = await _org(conn, "Washoe Tenants")
        shared = await SourceCRUD.create(
            conn, "https://example.org/shared", "org_website", "manual"
        )
        filing = await SourceCRUD.create(
            conn, "https://example.org/filing", "org_website", "manual"
        )
        for entry_id, source_id in (
            (keep.id, shared),
            (duplicate.id, shared),
            (duplicate.id, filing),
        ):
            await SourceCRUD.link_to_entry(conn, entry_id, source_id)
        await FollowCRUD.follow(conn, user_id="user-both", entry_id=keep.id)
        await FollowCRUD.follow(conn, user_id="user-both", entry_id=duplicate.id)
        await conn.commit()

        merge = await EntryMergeCRUD.merge(
            conn, keep, duplicate, reason="Same EIN.", merged_by="editor@example.org"
        )

        assert (merge.moved.sources, merge.moved.followers) == (1, 0)
        assert "T" in merge.merged_at
        cursor = await conn.execute(
            "SELECT entry_id FROM slug_aliases WHERE old_slug = ?", (duplicate.slug,)
        )
        assert await cursor.fetchall() == [(keep.id,)]
        with pytest.raises(psycopg.errors.RaiseException, match="merged into another profile"):
            await conn.execute("UPDATE entries SET active = TRUE WHERE id = ?", (duplicate.id,))
        await conn.rollback()

        await SourceCRUD.link_to_entry(conn, duplicate.id, filing)

        async def no_blockers(*_args: object) -> tuple[str, ...]:
            return ()

        monkeypatch.setattr(merges_module, "_blockers", no_blockers)
        with pytest.raises(MergeBlockedError, match="already merged"):
            await EntryMergeCRUD.merge(conn, other, duplicate, reason="Again.", merged_by="e")
        cursor = await conn.execute(
            "SELECT source_id FROM entry_sources WHERE entry_id = ?", (duplicate.id,)
        )
        assert await cursor.fetchall() == [(filing,)]
    finally:
        await conn.close()
