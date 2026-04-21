"""Tests for database schema initialization, migrations, and helper utilities."""

from __future__ import annotations

import json
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import aiosqlite
import pytest

from atlas.models.database import (
    PostgresConnection,
    PostgresCursor,
    _ensure_entry_columns,
    _get_sqlite_path,
    _init_sqlite,
    _is_postgres_url,
    _load_postgres_schema,
    _translate_placeholders,
    db,
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
        mock_conn = AsyncMock()
        mock_inner_cursor = AsyncMock()
        mock_conn.executemany.return_value = mock_inner_cursor
        wrapper = PostgresConnection(mock_conn)

        cursor = await wrapper.executemany(
            "INSERT INTO t (a) VALUES (?)",
            [(1,), (2,)],
        )

        mock_conn.executemany.assert_called_once_with(
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
                "postgresql://localhost/atlas", autocommit=False
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

        # Verify tables were created
        conn = await aiosqlite.connect(db_path)
        try:
            cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = {row[0] for row in await cursor.fetchall()}
            assert "entries" in tables
            assert "sources" in tables
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


class TestEnsureEntryColumns:
    """Tests for the _ensure_entry_columns migration helper."""

    @pytest.mark.asyncio
    async def test_adds_full_address_column_when_missing(self) -> None:
        """Missing full_address column should be added by the migration."""
        conn = await aiosqlite.connect(":memory:")
        try:
            # Create a minimal entries table WITHOUT full_address
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            # Verify column was added
            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert "full_address" in columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_column_already_exists(self) -> None:
        """The migration should be idempotent when full_address already exists."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    full_address TEXT
                )"""
            )
            await conn.commit()

            # Should not raise
            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert "full_address" in columns
        finally:
            await conn.close()


class TestDatabaseManager:
    """Tests for the DatabaseManager utility class."""

    def test_generate_uuid_returns_valid_string(self) -> None:
        uuid_val = db.generate_uuid()
        assert isinstance(uuid_val, str)
        uuid_length = 36  # UUID format: 8-4-4-4-12
        assert len(uuid_val) == uuid_length

    def test_now_iso_returns_iso_format(self) -> None:
        iso_val = db.now_iso()
        assert isinstance(iso_val, str)
        assert "T" in iso_val

    def test_encode_json(self) -> None:
        data = {"key": "value", "num": 42}
        encoded = db.encode_json(data)
        assert json.loads(encoded) == data

    def test_decode_json(self) -> None:
        raw = '{"key": "value", "num": 42}'
        decoded = db.decode_json(raw)
        assert decoded == {"key": "value", "num": 42}

    def test_roundtrip_json(self) -> None:
        original = [1, 2, {"nested": True}]
        encoded = db.encode_json(original)
        decoded = db.decode_json(encoded)
        assert decoded == original


class TestLoadPostgresSchema:
    """Tests for the _load_postgres_schema function."""

    def test_loads_schema_file(self) -> None:
        """The function should load a SQL string from the bundled schema file."""
        mock_path = MagicMock()
        mock_path.read_text.return_value = "CREATE TABLE test (id SERIAL PRIMARY KEY);"

        with patch("atlas.models.database.importlib.resources.files") as mock_files:
            mock_files.return_value.__truediv__ = MagicMock(return_value=mock_path)
            result = _load_postgres_schema()
            assert "CREATE TABLE" in result
