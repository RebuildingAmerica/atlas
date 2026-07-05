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
    _ensure_discovery_job_columns,
    _ensure_discovery_run_columns,
    _ensure_entry_columns,
    _ensure_org_annotation_columns,
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

    @pytest.mark.asyncio
    async def test_adds_geocode_columns_and_index_when_missing(self) -> None:
        """The migration should add the geocode columns and the lat/lng index."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert {
                "latitude",
                "longitude",
                "geocode_precision",
                "geocode_source",
            } <= columns

            index_cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                ("idx_entries_lat_lng",),
            )
            assert await index_cursor.fetchone() is not None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_geocode_columns_when_already_present(self) -> None:
        """The migration should be idempotent when geocode columns already exist."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    geocode_precision TEXT,
                    geocode_source TEXT
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert "geocode_source" in columns
        finally:
            await conn.close()


class TestEnsureOrgAnnotationColumns:
    """Tests for the org_annotations typed-target migration helper."""

    @pytest.mark.asyncio
    async def test_skips_when_table_missing(self) -> None:
        """Fresh databases should let the full schema create org_annotations."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await _ensure_org_annotation_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(org_annotations)")
            assert await cursor.fetchall() == []
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_rebuilds_legacy_not_null_entry_table(self) -> None:
        """Legacy entry-only notes should survive the nullable target migration."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE entries (id TEXT PRIMARY KEY);
                CREATE TABLE sources (id TEXT PRIMARY KEY);
                INSERT INTO entries (id) VALUES ('entry-1');
                INSERT INTO sources (id) VALUES ('source-1');
                CREATE TABLE org_annotations (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    entry_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (entry_id) REFERENCES entries(id)
                );
                INSERT INTO org_annotations (
                    id, org_id, entry_id, content, author_id, created_at, updated_at
                ) VALUES (
                    'note-1', 'org-1', 'entry-1', 'Legacy note', 'user-1',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_org_annotation_columns(conn)

            cursor = await conn.execute(
                """
                SELECT entry_id, source_id, target_type, target_id, content
                FROM org_annotations
                WHERE id = 'note-1'
                """
            )
            assert await cursor.fetchone() == (
                "entry-1",
                None,
                "entry",
                "entry-1",
                "Legacy note",
            )

            await conn.execute(
                """
                INSERT INTO org_annotations (
                    id, org_id, entry_id, source_id, target_type, target_id,
                    content, author_id, created_at, updated_at
                ) VALUES (
                    'note-2', 'org-1', NULL, 'source-1', 'source', 'source-1',
                    'Source note', 'user-1',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                )
                """
            )

            index_cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                ("idx_org_annotations_target",),
            )
            assert await index_cursor.fetchone() is not None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_missing_typed_target_columns(self) -> None:
        """Loose entry-note tables should gain source and typed target columns."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE org_annotations (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    entry_id TEXT,
                    content TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO org_annotations (
                    id, org_id, entry_id, content, author_id, created_at, updated_at
                ) VALUES (
                    'note-1', 'org-1', 'entry-1', 'Loose note', 'user-1',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_org_annotation_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(org_annotations)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert {"source_id", "target_type", "target_id"} <= columns

            note_cursor = await conn.execute(
                "SELECT target_type, target_id FROM org_annotations WHERE id = 'note-1'"
            )
            assert await note_cursor.fetchone() == ("entry", "entry-1")
        finally:
            await conn.close()


class TestEnsureDiscoveryRunColumns:
    """Tests for the discovery_runs research-output migration helper."""

    @pytest.mark.asyncio
    async def test_skips_when_table_missing(self) -> None:
        """Fresh databases should let the full schema create discovery_runs."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await _ensure_discovery_run_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_runs)")
            assert await cursor.fetchall() == []
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_research_goal_and_summary_when_missing(self) -> None:
        """Existing run rows should gain goal and summary columns without data loss."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE discovery_runs (
                    id TEXT PRIMARY KEY,
                    location_query TEXT NOT NULL,
                    state TEXT NOT NULL,
                    issue_areas TEXT NOT NULL,
                    started_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                );
                INSERT INTO discovery_runs (
                    id, location_query, state, issue_areas, started_at, status, created_at
                ) VALUES (
                    'run-1', 'Austin, TX', 'TX', '["housing_affordability"]',
                    '2026-01-01T00:00:00Z', 'completed', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_discovery_run_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_runs)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert {"research_goal", "research_summary"} <= columns

            row_cursor = await conn.execute(
                """
                SELECT location_query, research_goal, research_summary
                FROM discovery_runs
                WHERE id = ?
                """,
                ("run-1",),
            )
            assert await row_cursor.fetchone() == ("Austin, TX", "landscape_scan", None)
        finally:
            await conn.close()


class TestEnsureDiscoveryJobColumns:
    """Tests for the discovery_jobs retry/idempotency migration helper."""

    @pytest.mark.asyncio
    async def test_skips_when_table_missing(self) -> None:
        """Fresh databases should let the full schema create discovery_jobs."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await _ensure_discovery_job_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
            assert await cursor.fetchall() == []
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_job_metadata_columns_before_indexes_run(self) -> None:
        """Existing job rows should gain worker-routing columns before indexes execute."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE discovery_jobs (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    progress TEXT,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    claimed_by TEXT,
                    claimed_until DATETIME,
                    created_at DATETIME NOT NULL,
                    started_at DATETIME,
                    completed_at DATETIME,
                    updated_at DATETIME NOT NULL
                );
                INSERT INTO discovery_jobs (
                    id, run_id, status, created_at, updated_at
                ) VALUES (
                    'job-1', 'run-1', 'queued',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_discovery_job_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert {
                "idempotency_key",
                "input_payload",
                "execution_mode",
                "next_attempt_at",
            } <= columns

            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_jobs_idempotency "
                "ON discovery_jobs(idempotency_key)"
            )
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
