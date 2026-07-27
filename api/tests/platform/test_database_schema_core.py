"""Tests for database connection helpers and initial schema setup."""

from __future__ import annotations

import tempfile
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest

from atlas.models.database import (
    PostgresConnection,
    PostgresCursor,
    _get_sqlite_path,
    _init_sqlite,
    _is_postgres_url,
    _load_postgres_schema,
    _translate_placeholders,
    get_db_connection,
    init_db,
)


class TestIsPostgresUrl:
    """Tests for the _is_postgres_url helper."""

    def test_postgresql_scheme(self) -> None:
        assert _is_postgres_url("postgresql://localhost/atlas") is True

    def test_postgres_scheme(self) -> None:
        assert _is_postgres_url("postgres://localhost/atlas") is True

    def test_sqlite_scheme(self) -> None:
        assert _is_postgres_url("sqlite:///atlas.db") is False

    def test_plain_path(self) -> None:
        assert _is_postgres_url("/tmp/atlas.db") is False


class TestGetSqlitePath:
    """Tests for the _get_sqlite_path helper."""

    def test_triple_slash_prefix(self) -> None:
        assert _get_sqlite_path("sqlite:///path/to/db.sqlite") == "path/to/db.sqlite"

    def test_double_slash_prefix(self) -> None:
        assert _get_sqlite_path("sqlite://path/to/db.sqlite") == "path/to/db.sqlite"

    def test_plain_path_passthrough(self) -> None:
        assert _get_sqlite_path("/tmp/atlas.db") == "/tmp/atlas.db"


class TestTranslatePlaceholders:
    """Tests for the SQL placeholder translation function."""

    def test_simple_replacement(self) -> None:
        assert _translate_placeholders("SELECT * FROM t WHERE id = ?") == (
            "SELECT * FROM t WHERE id = %s"
        )

    def test_multiple_placeholders(self) -> None:
        result = _translate_placeholders("INSERT INTO t (a, b) VALUES (?, ?)")
        assert result == "INSERT INTO t (a, b) VALUES (%s, %s)"

    def test_preserves_single_quoted_question_marks(self) -> None:
        result = _translate_placeholders("SELECT * FROM t WHERE val = '?'")
        assert result == "SELECT * FROM t WHERE val = '?'"

    def test_preserves_double_quoted_question_marks(self) -> None:
        result = _translate_placeholders('SELECT * FROM "col?" WHERE id = ?')
        assert result == 'SELECT * FROM "col?" WHERE id = %s'

    def test_no_placeholders(self) -> None:
        sql = "SELECT 1"
        assert _translate_placeholders(sql) == sql

    def test_mixed_quotes_and_placeholders(self) -> None:
        sql = """SELECT * FROM t WHERE a = ? AND b = 'literal?' AND c = ?"""
        result = _translate_placeholders(sql)
        assert result == """SELECT * FROM t WHERE a = %s AND b = 'literal?' AND c = %s"""


class TestPostgresCursor:
    """Tests for the PostgresCursor adapter."""

    def test_description_property(self) -> None:
        mock_cursor = MagicMock()
        mock_cursor.description = [("id", None, None)]
        wrapper = PostgresCursor(mock_cursor)
        assert wrapper.description == [("id", None, None)]

    def test_rowcount_property(self) -> None:
        mock_cursor = MagicMock()
        expected_rowcount = 5
        mock_cursor.rowcount = expected_rowcount
        wrapper = PostgresCursor(mock_cursor)
        assert wrapper.rowcount == expected_rowcount

    @pytest.mark.asyncio
    async def test_fetchall(self) -> None:
        mock_cursor = AsyncMock()
        mock_cursor.fetchall.return_value = [(1, "a"), (2, "b")]
        wrapper = PostgresCursor(mock_cursor)
        result = await wrapper.fetchall()
        assert result == [(1, "a"), (2, "b")]

    @pytest.mark.asyncio
    async def test_fetchone(self) -> None:
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = (1, "a")
        wrapper = PostgresCursor(mock_cursor)
        result = await wrapper.fetchone()
        assert result == (1, "a")

    @pytest.mark.asyncio
    async def test_fetchone_returns_none(self) -> None:
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        wrapper = PostgresCursor(mock_cursor)
        result = await wrapper.fetchone()
        assert result is None

    @pytest.mark.asyncio
    async def test_fetchall_normalizes_datetime_and_date_values(self) -> None:
        """psycopg hydrates timestamps and dates as objects; readers expect ISO strings."""
        mock_cursor = AsyncMock()
        mock_cursor.fetchall.return_value = [
            (1, datetime(2026, 7, 27, 12, 0, 0, tzinfo=UTC), date(2026, 7, 27)),
        ]
        wrapper = PostgresCursor(mock_cursor)
        result = await wrapper.fetchall()
        assert result == [(1, "2026-07-27T12:00:00+00:00", "2026-07-27")]

    @pytest.mark.asyncio
    async def test_fetchone_normalizes_datetime_and_date_values(self) -> None:
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = (
            1,
            datetime(2026, 7, 27, 12, 0, 0, tzinfo=UTC),
            date(2026, 7, 27),
        )
        wrapper = PostgresCursor(mock_cursor)
        result = await wrapper.fetchone()
        assert result == (1, "2026-07-27T12:00:00+00:00", "2026-07-27")


class TestPostgresConnection:
    """Tests for the PostgresConnection adapter."""

    @pytest.mark.asyncio
    async def test_execute_translates_placeholders(self) -> None:
        mock_conn = AsyncMock()
        mock_inner_cursor = AsyncMock()
        mock_conn.execute.return_value = mock_inner_cursor
        wrapper = PostgresConnection(mock_conn)

        cursor = await wrapper.execute("SELECT * FROM t WHERE id = ?", (1,))

        mock_conn.execute.assert_called_once_with("SELECT * FROM t WHERE id = %s", (1,))
        assert isinstance(cursor, PostgresCursor)

    @pytest.mark.asyncio
    async def test_execute_with_empty_params(self) -> None:
        mock_conn = AsyncMock()
        mock_inner_cursor = AsyncMock()
        mock_conn.execute.return_value = mock_inner_cursor
        wrapper = PostgresConnection(mock_conn)

        await wrapper.execute("SELECT 1", ())

        mock_conn.execute.assert_called_once_with("SELECT 1", None)

    @pytest.mark.asyncio
    async def test_executemany(self) -> None:
        """executemany runs on a cursor: psycopg's connection has no such method."""
        mock_inner_cursor = AsyncMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_inner_cursor
        wrapper = PostgresConnection(mock_conn)

        cursor = await wrapper.executemany(
            "INSERT INTO t (a) VALUES (?)",
            [(1,), (2,)],
        )

        mock_inner_cursor.executemany.assert_called_once_with(
            "INSERT INTO t (a) VALUES (%s)",
            [(1,), (2,)],
        )
        assert isinstance(cursor, PostgresCursor)

    @pytest.mark.asyncio
    async def test_commit(self) -> None:
        mock_conn = AsyncMock()
        wrapper = PostgresConnection(mock_conn)
        await wrapper.commit()
        mock_conn.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_close(self) -> None:
        mock_conn = AsyncMock()
        wrapper = PostgresConnection(mock_conn)
        await wrapper.close()
        mock_conn.close.assert_called_once()

    def test_backend_attribute(self) -> None:
        mock_conn = AsyncMock()
        wrapper = PostgresConnection(mock_conn)
        assert wrapper.backend == "postgres"


class TestGetDbConnection:
    """Tests for the get_db_connection function."""

    @pytest.mark.asyncio
    async def test_sqlite_connection(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        conn = await get_db_connection(f"sqlite:///{db_path}")
        try:
            assert isinstance(conn, aiosqlite.Connection)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_postgres_connection_attempts_import(self) -> None:
        """Postgres URLs should attempt to import psycopg and connect."""
        mock_async_conn = AsyncMock()
        mock_psycopg = MagicMock()
        mock_psycopg.AsyncConnection.connect = AsyncMock(return_value=mock_async_conn)

        with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
            conn = await get_db_connection("postgresql://localhost/atlas")
            assert isinstance(conn, PostgresConnection)
            mock_psycopg.AsyncConnection.connect.assert_called_once_with(
                "postgresql://localhost/atlas", autocommit=False, options="-c TimeZone=UTC"
            )


class TestInitDb:
    """Tests for init_db dispatching."""

    @pytest.mark.asyncio
    async def test_init_db_sqlite(self) -> None:
        """init_db should initialize an SQLite database without error."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name
        db_url = f"sqlite:///{db_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(db_path)
        try:
            cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = {row[0] for row in await cursor.fetchall()}
            assert "entries" in tables
            assert "sources" in tables
            assert "entity_identity_keys" in tables
            assert "entity_relationship_edges" in tables
            assert "discovery_runs" in tables
            assert "resource_ownership" in tables
            assert "org_annotations" in tables
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_init_db_postgres_dispatches(self) -> None:
        """init_db should call _init_postgres for PostgreSQL URLs."""
        with patch("atlas.models.database._init_postgres", new_callable=AsyncMock) as mock_init:
            await init_db("postgresql://localhost/atlas")
            mock_init.assert_called_once_with("postgresql://localhost/atlas")

    def test_postgres_schema_includes_discovery_run_syncs(self) -> None:
        """PostgreSQL startup should create the Scout sync idempotency table."""
        schema = _load_postgres_schema()

        assert "ADD COLUMN IF NOT EXISTS research_goal" in schema
        assert "ADD COLUMN IF NOT EXISTS research_summary" in schema
        assert "CREATE TABLE IF NOT EXISTS discovery_run_syncs" in schema
        assert "UNIQUE(local_run_id, artifact_hash)" in schema
        assert "idx_discovery_run_syncs_local_run_id" in schema
        assert "idx_discovery_run_syncs_remote_run_id" in schema


class TestInitSqlite:
    """Tests for _init_sqlite error handling."""

    @pytest.mark.asyncio
    async def test_init_sqlite_handles_errors(self) -> None:
        """_init_sqlite should propagate exceptions after logging."""
        with (
            patch(
                "atlas.models.database.get_db_connection",
                new_callable=AsyncMock,
            ) as mock_conn_fn,
        ):
            mock_conn = AsyncMock()
            mock_conn.executescript = AsyncMock(side_effect=RuntimeError("schema error"))
            mock_conn.close = AsyncMock()
            mock_conn_fn.return_value = mock_conn

            with pytest.raises(RuntimeError, match="schema error"):
                await _init_sqlite("sqlite:///test.db")

            mock_conn.close.assert_called_once()
