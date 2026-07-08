"""Daemon edge cases and schema migration coverage for atlas_scout.store.ScoutStore."""

from __future__ import annotations

import aiosqlite
import pytest

from atlas_scout.store import ScoutStore


async def test_start_daemon_rejects_non_positive_process_id(store: ScoutStore) -> None:
    """A zero/negative process_id is rejected by validation."""
    with pytest.raises(ValueError, match="process_id must be positive"):
        await store.start_daemon(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
            process_id=0,
        )


async def test_start_daemon_rejects_negative_interval_seconds(store: ScoutStore) -> None:
    """A negative interval_seconds is rejected by validation."""
    with pytest.raises(ValueError, match="interval_seconds must be non-negative"):
        await store.start_daemon(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
            interval_seconds=-5,
        )


async def test_close_is_idempotent(tmp_db_path) -> None:
    """Calling close twice does nothing the second time."""
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    await s.close()
    await s.close()


async def test_get_daemon_state_raises_when_table_empty(store: ScoutStore) -> None:
    """get_daemon_state raises KeyError when the row is missing."""
    await store._db.execute("DELETE FROM daemon_state WHERE key = ?", ("scout",))
    with pytest.raises(KeyError, match="not initialized"):
        await store.get_daemon_state()


async def test_claim_daemon_start_raises_when_table_empty(store: ScoutStore) -> None:
    """claim_daemon_start raises KeyError when the row is missing."""
    await store._db.execute("DELETE FROM daemon_state WHERE key = ?", ("scout",))
    with pytest.raises(KeyError, match="not initialized"):
        await store.claim_daemon_start(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
        )


async def test_claim_daemon_start_rolls_back_on_unexpected_exception(
    store: ScoutStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unexpected exception during the BEGIN IMMEDIATE block triggers rollback."""
    # Force fetchone to raise to exercise the except/rollback path.
    original_execute = store._db.connection.execute

    call_count = {"value": 0}

    class _RaisingCursor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def fetchone(self):
            raise RuntimeError("simulated cursor failure")

    def _patched_execute(*args, **kwargs):
        # Pass BEGIN IMMEDIATE through normally; intercept the SELECT inside the txn.
        call_count["value"] += 1
        sql = args[0] if args else ""
        if call_count["value"] == 2 and "SELECT status" in sql:
            return _RaisingCursor()
        return original_execute(*args, **kwargs)

    monkeypatch.setattr(store._db.connection, "execute", _patched_execute)

    with pytest.raises(RuntimeError, match="simulated cursor failure"):
        await store.claim_daemon_start(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
        )


async def test_daemon_state_table_migration_replays_legacy_schema(tmp_path) -> None:
    """A legacy daemon_state schema is rewritten to the current shape on initialize."""
    db_path = tmp_path / "legacy.db"

    # Create a legacy daemon_state table missing the new constraints/columns.
    async with aiosqlite.connect(str(db_path)) as conn:
        await conn.execute(
            """
            CREATE TABLE daemon_state (
                key TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'stopped',
                started_at TEXT,
                last_heartbeat_at TEXT,
                config_path TEXT,
                profile_name TEXT,
                target_count INTEGER NOT NULL DEFAULT 0,
                last_tick_summary TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        await conn.execute(
            "INSERT INTO daemon_state (key, status, target_count, updated_at) VALUES (?, ?, ?, ?)",
            ("scout", "stopped", -1, "2025-01-01T00:00:00+00:00"),
        )
        await conn.commit()

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        daemon_state = await store.get_daemon_state()
        # Legacy negative target_count should be reset to 0 by the migration.
        assert daemon_state["target_count"] == 0
        # New columns now exist.
        assert "process_id" in daemon_state
        assert "interval_seconds" in daemon_state
        assert "interval_basis" in daemon_state
    finally:
        await store.close()


async def test_daemon_state_table_adds_missing_columns(tmp_path) -> None:
    """When the table has the new constraint but missing newer columns, ALTER TABLE adds them."""
    db_path = tmp_path / "partial.db"

    # Create the daemon_state table with the new constraint shape but missing
    # the process_id / interval_seconds / interval_basis columns.
    async with aiosqlite.connect(str(db_path)) as conn:
        await conn.execute(
            """
            CREATE TABLE daemon_state (
                key TEXT PRIMARY KEY CHECK(key = 'scout'),
                status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('starting', 'running', 'stopped')),
                started_at TEXT,
                last_heartbeat_at TEXT,
                config_path TEXT,
                profile_name TEXT,
                target_count INTEGER NOT NULL DEFAULT 0 CHECK(target_count >= 0),
                last_tick_summary TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        await conn.commit()

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        daemon_state = await store.get_daemon_state()
        assert daemon_state["process_id"] is None
        assert daemon_state["interval_seconds"] is None
        assert daemon_state["interval_basis"] is None
    finally:
        await store.close()
