"""Tests for database schema migration helpers."""

from __future__ import annotations

import aiosqlite
import pytest

from atlas.models.database import (
    _ensure_discovery_job_columns,
    _ensure_discovery_run_columns,
    _ensure_entry_columns,
    _ensure_org_annotation_columns,
)


class TestEnsureEntryColumns:
    """Tests for the _ensure_entry_columns migration helper."""

    @pytest.mark.asyncio
    async def test_adds_full_address_column_when_missing(self) -> None:
        """Missing full_address column should be added by the migration."""
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
