"""Takedowns as production PostgreSQL enforces them."""

from __future__ import annotations

import psycopg
import pytest

from atlas.domains.moderation.takedowns import EntryTakedownCRUD, TakedownConflictError
from atlas.models import EntryCRUD, init_db
from atlas.models.database import PostgresConnection


@pytest.mark.asyncio
async def test_postgres_keeps_a_taken_down_profile_down(postgres_database_url: str) -> None:
    """One standing takedown per profile, and no publish while it stands."""
    await init_db(postgres_database_url)
    raw_conn = await psycopg.AsyncConnection.connect(postgres_database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Dana Example",
            description="Asked to be removed.",
            city="Reno",
            state="NV",
            geo_specificity="local",
        )
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        assert entry is not None
        assert entry.slug is not None
        target = await EntryTakedownCRUD.find_target(conn, entry.slug)
        assert target is not None

        takedown = await EntryTakedownCRUD.take_down(
            conn, target, reason="Asked by email.", taken_down_by="editor@example.org"
        )
        with pytest.raises(TakedownConflictError):
            await EntryTakedownCRUD.take_down(
                conn, target, reason="Again.", taken_down_by="editor@example.org"
            )
        with pytest.raises(psycopg.errors.RaiseException, match="entry is taken down"):
            await conn.execute("UPDATE entries SET active = TRUE WHERE id = ?", (entry_id,))

        assert "T" in takedown.taken_down_at
        restored = await EntryTakedownCRUD.restore(
            conn, takedown.id, restored_by="editor@example.org"
        )
        assert restored is not None
        assert restored.restored_at is not None
        republished = await EntryCRUD.get_by_id(conn, entry_id)
        assert republished is not None
        assert republished.active is True
    finally:
        await raw_conn.close()
