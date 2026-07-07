"""SQLite lock retry tests for ScoutStore."""

import asyncio
import sqlite3
from collections.abc import Iterator
from typing import Any

from atlas_scout.store import ScoutStore


async def test_execute_retries_transient_sqlite_locks() -> None:
    class FlakyConnection:
        def __init__(self) -> None:
            self.execute_calls = 0
            self.commit_calls = 0
            self.rollback_calls = 0

        async def execute(self, _sql: str, _params: tuple[object, ...]) -> object:
            self.execute_calls += 1
            if self.execute_calls == 1:
                raise sqlite3.OperationalError("database is locked")
            return object()

        async def commit(self) -> None:
            self.commit_calls += 1

        async def rollback(self) -> None:
            self.rollback_calls += 1

    store = ScoutStore(":memory:")
    connection = FlakyConnection()
    store._db._conn = connection  # type: ignore[assignment]

    await store._db.execute("UPDATE example SET value = ?", ("ok",))

    assert connection.execute_calls == 2
    assert connection.commit_calls == 1
    assert connection.rollback_calls == 1


async def test_claim_work_retries_transient_insert_locks(tmp_db_path: object) -> None:
    lock_store = ScoutStore(str(tmp_db_path))
    claim_store = ScoutStore(str(tmp_db_path))
    await lock_store.initialize()
    await claim_store.initialize()
    try:
        assert lock_store._db.connection is not None
        assert claim_store._db.connection is not None
        await claim_store._db.connection.execute("PRAGMA busy_timeout=1")
        await lock_store._db.connection.execute("BEGIN IMMEDIATE")

        async def release_lock() -> None:
            await asyncio.sleep(0.1)
            assert lock_store._db.connection is not None
            await lock_store._db.connection.rollback()

        release_task = asyncio.create_task(release_lock())
        try:
            claimed = await claim_store.claim_work(
                "fetch:https://locked.test/story",
                owner_run_id="run-after-lock",
                lease_seconds=300,
            )
        finally:
            await release_task

        assert claimed is True
    finally:
        await claim_store.close()
        await lock_store.close()


async def test_initialize_retries_transient_schema_locks(monkeypatch: Any) -> None:
    class FakeCursor:
        rowcount = 0

        def __await__(self) -> Iterator["FakeCursor"]:
            async def _return_self() -> FakeCursor:
                return self

            return _return_self().__await__()

        async def __aenter__(self) -> "FakeCursor":
            return self

        async def __aexit__(self, *_exc_info: object) -> None:
            return None

        async def fetchone(self) -> dict[str, str]:
            return {"sql": "CHECK(target_count >= 0) CHECK(status IN ('starting'))"}

        async def fetchall(self) -> list[dict[str, str]]:
            return [
                {"name": "claimed_by"},
                {"name": "claimed_at"},
                {"name": "claim_expires_at"},
                {"name": "process_id"},
                {"name": "interval_seconds"},
                {"name": "interval_basis"},
            ]

    class FlakyConnection:
        def __init__(self) -> None:
            self.row_factory: object | None = None
            self.locked_once = False
            self.commit_calls = 0
            self.rollback_calls = 0

        def execute(self, sql: str, _params: tuple[object, ...] = ()) -> FakeCursor:
            if "CREATE TABLE IF NOT EXISTS runs" in sql and not self.locked_once:
                self.locked_once = True
                raise sqlite3.OperationalError("database is locked")
            return FakeCursor()

        async def commit(self) -> None:
            self.commit_calls += 1

        async def rollback(self) -> None:
            self.rollback_calls += 1

    connection = FlakyConnection()

    async def fake_connect(_db_path: str) -> FlakyConnection:
        return connection

    monkeypatch.setattr("atlas_scout.store.db.aiosqlite.connect", fake_connect)

    store = ScoutStore("locked.db")

    await store.initialize()

    assert connection.locked_once is True
    assert connection.rollback_calls == 1
    assert connection.commit_calls == 1
