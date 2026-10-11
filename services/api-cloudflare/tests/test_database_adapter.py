"""Exercise Atlas's database contract against an isolated local PostgreSQL."""

import asyncio
import os
from uuid import uuid4

import pytest
from database_adapter import connect_database

pytestmark = pytest.mark.skipif(
    os.environ.get("ATLAS_CF_LOCAL_POSTGRES") != "1",
    reason="Requires the disposable loopback PostgreSQL fixture",
)


async def connect():
    return await connect_database(
        host="127.0.0.1", port=55439, user="postgres", password="", database="postgres"
    )


@pytest.mark.asyncio
async def test_cursor_contract_dates_json_and_literal_question_marks():
    db = await connect()
    try:
        cursor = await db.execute(
            "SELECT ?::timestamptz AS source_date, ?::date AS filing_date, "
            "?::jsonb AS evidence, '?'::text AS literal, ?::text AS label "
            "/* ? */ -- ?\n",
            ("2000-01-01T05:30:00+05:30", "2000-01-01", '{"trusted":true}', "profile"),
        )
        assert [item[0] for item in cursor.description] == [
            "source_date",
            "filing_date",
            "evidence",
            "literal",
            "label",
        ]
        assert cursor.rowcount == 1
        assert await cursor.fetchone() == (
            "2000-01-01T00:00:00+00:00",
            "2000-01-01",
            {"trusted": True},
            "?",
            "profile",
        )
        assert await cursor.fetchone() is None
        assert await cursor.fetchall() == []
        cursor = await db.execute("SELECT $$?$$ AS literal, ?::int AS value", (7,))
        assert await cursor.fetchall() == [("?", 7)]
    finally:
        await db.close()
    assert db.is_closed()


@pytest.mark.asyncio
async def test_commit_visibility_rowcount_and_close_rollback():
    first, observer = await connect(), await connect()
    table = "cf_probe_" + uuid4().hex
    try:
        await first.execute(
            f"CREATE TABLE {table} (id integer PRIMARY KEY, label text)"
        )
        await first.commit()
        cursor = await first.executemany(
            f"INSERT INTO {table} VALUES (?, ?)", [(1, "first"), (2, "second")]
        )
        assert cursor.rowcount == 2
        assert await (
            await observer.execute(f"SELECT count(*) FROM {table}")
        ).fetchone() == (0,)
        await observer.commit()
        await first.commit()
        cursor = await first.execute(
            f"UPDATE {table} SET label = ? WHERE id = ?", ("updated", 1)
        )
        assert cursor.rowcount == 1
        assert cursor.description is None
        await first.execute("ROLLBACK")
        assert await (
            await first.execute(f"SELECT label FROM {table} WHERE id = ?", (1,))
        ).fetchone() == ("first",)
        await first.execute(f"DELETE FROM {table} WHERE id = ?", (2,))
        await first.close()
        assert await (
            await observer.execute(f"SELECT count(*) FROM {table}")
        ).fetchone() == (2,)
    finally:
        await first.close()
        await observer.execute(f"DROP TABLE IF EXISTS {table}")
        await observer.commit()
        await observer.close()


@pytest.mark.asyncio
async def test_cancellation_releases_the_request_connection():
    db = await connect()

    async def query():
        try:
            await db.execute("SELECT pg_sleep(30)")
        finally:
            await db.close()

    task = asyncio.create_task(query())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert db.is_closed()


@pytest.mark.asyncio
async def test_sequential_queries_materialize_results_without_named_statement_resources():
    db = await connect()
    try:
        first = await db.execute("SELECT ?::int AS first_value", (7,))
        second = await db.execute(
            "SELECT ?::text AS next_value, ?::int AS ordinal", ("profile", 2)
        )
        assert first.description == [("first_value",)]
        assert await first.fetchall() == [(7,)]
        assert second.description == [("next_value",), ("ordinal",)]
        assert await second.fetchall() == [("profile", 2)]
        for ordinal in range(12):
            cursor = await db.execute("SELECT ?::int AS ordinal", (ordinal,))
            assert await cursor.fetchone() == (ordinal,)
        resources = await db.execute("SELECT count(*) FROM pg_prepared_statements")
        assert await resources.fetchone() == (0,)
        await db.commit()
        cursor = await db.execute("SELECT ?::text AS after_commit", ("retained",))
        assert await cursor.fetchall() == [("retained",)]
    finally:
        await db.close()
    assert db.is_closed()
