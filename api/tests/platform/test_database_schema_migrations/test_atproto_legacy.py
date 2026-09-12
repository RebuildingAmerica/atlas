"""ATProto identity graph migration: legacy cases."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING
from uuid import UUID

import aiosqlite
import pytest

from atlas.models.database import (
    init_db,
)
from atlas.models.database_migrations import (
    migrate_atproto_identity_graph,
)

if TYPE_CHECKING:
    from pathlib import Path

from tests.platform.test_database_schema_migrations.support import (
    LEGACY_ATPROTO_COLUMNS,
    TIMESTAMP,
    _insert_legacy_entry,
    _insert_legacy_identity_link,
    _legacy_database,
    _PausingSqliteConnection,
)


class TestMigrateAtprotoIdentityGraph:
    @pytest.mark.asyncio
    async def test_sqlite_migration_blocks_writes_before_reading_source_rows(
        self,
        tmp_path: Path,
    ) -> None:
        """SQLite should reserve its write transaction before snapshotting legacy rows."""
        database_path = tmp_path / "sqlite-lock.db"
        setup_conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_identity_link(
                setup_conn,
                key="lock",
                did="did:plc:lock",
                handle="lock.example",
            )
            await setup_conn.commit()
        finally:
            await setup_conn.close()

        migration_inner = await aiosqlite.connect(database_path, timeout=0.1)
        observer_conn = await aiosqlite.connect(database_path, timeout=0.1)
        source_read_reached = asyncio.Event()
        resume_source_read = asyncio.Event()
        migration_conn = _PausingSqliteConnection(
            migration_inner,
            source_read_reached=source_read_reached,
            resume_source_read=resume_source_read,
        )
        migration_task = asyncio.create_task(
            migrate_atproto_identity_graph(migration_conn, backend="sqlite")
        )
        write_error: Exception | None = None
        migration_error: Exception | None = None
        try:
            await asyncio.wait_for(source_read_reached.wait(), timeout=5)
            try:
                await observer_conn.execute(
                    "UPDATE entries SET updated_at = updated_at WHERE id = 'entry-lock'"
                )
                await asyncio.wait_for(observer_conn.commit(), timeout=1)
            except Exception as exc:  # noqa: BLE001 - assertion records the database error
                write_error = exc
        finally:
            await observer_conn.rollback()
            resume_source_read.set()
            try:
                await asyncio.wait_for(migration_task, timeout=5)
            except Exception as exc:  # noqa: BLE001 - re-raised after guaranteed cleanup
                migration_error = exc
            finally:
                await observer_conn.close()
                await migration_inner.close()
        if migration_error is not None:
            raise migration_error
        assert isinstance(write_error, aiosqlite.OperationalError)
        assert "database is locked" in str(write_error)

    @pytest.mark.asyncio
    async def test_preserves_single_owner_and_multiple_profile_links(
        self,
        tmp_path: Path,
    ) -> None:
        """One legacy owner should keep control and every represented profile."""
        database_path = tmp_path / "single-owner.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute(
                """
                INSERT INTO atproto_identities (
                    id, user_id, did, current_handle, pds_url, did_resolved_at,
                    handle_verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "identity-preserved",
                    "user-one",
                    "did:plc:one",
                    "one.example",
                    "https://pds.example",
                    "2026-07-10T12:00:00+00:00",
                    "2026-07-11T12:00:00+00:00",
                    "2026-07-01T12:00:00+00:00",
                    TIMESTAMP,
                ),
            )
            await _insert_legacy_entry(
                conn,
                "entry-one",
                did="did:plc:one",
                handle="one.example",
                verified_at="2026-07-11T12:00:00+00:00",
            )
            await _insert_legacy_entry(
                conn,
                "entry-two",
                did="did:plc:one",
                handle="one.example",
                verified_at="2026-07-11T13:00:00+00:00",
            )
            await conn.execute(
                """
                INSERT INTO profile_claims (
                    id, entry_id, user_id, user_email, status, tier,
                    verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'verified', 1, ?, ?, ?)
                """,
                (
                    "claim-preserved",
                    "entry-one",
                    "user-one",
                    "one@example.com",
                    TIMESTAMP,
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            )
            await conn.execute(
                """
                INSERT INTO profile_claim_proofs (
                    id, claim_id, proof_type, proof_status, proof_summary,
                    proof_metadata_json, created_at, reviewed_at
                ) VALUES (?, ?, 'atproto', 'verified', ?, ?, ?, ?)
                """,
                (
                    "proof-preserved",
                    "claim-preserved",
                    "Verified ATProto identity.",
                    json.dumps({"did": "did:plc:one", "handle": "one.example"}),
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            )
            await conn.commit()
        finally:
            await conn.close()

        db_url = f"sqlite:///{database_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            identity_cursor = await conn.execute(
                """
                SELECT id, did, current_handle, pds_url, resolution_status,
                       did_resolved_at, handle_verified_at
                FROM atproto_identities
                """
            )
            assert await identity_cursor.fetchall() == [
                (
                    "identity-preserved",
                    "did:plc:one",
                    "one.example",
                    "https://pds.example",
                    "verified",
                    "2026-07-10T12:00:00+00:00",
                    "2026-07-11T12:00:00+00:00",
                )
            ]

            control_cursor = await conn.execute(
                """
                SELECT id, identity_id, user_id, status, verified_at
                FROM user_atproto_controls
                """
            )
            controls = await control_cursor.fetchall()
            assert len(controls) == 1
            control_id, identity_id, user_id, status, verified_at = controls[0]
            assert UUID(control_id).version == 5
            assert (identity_id, user_id, status, verified_at) == (
                "identity-preserved",
                "user-one",
                "active",
                "2026-07-11T12:00:00+00:00",
            )

            link_cursor = await conn.execute(
                """
                SELECT id, entry_id, identity_id, claim_id, proof_id, status, verified_at
                FROM profile_atproto_links
                ORDER BY entry_id
                """
            )
            links = await link_cursor.fetchall()
            assert [UUID(link[0]).version for link in links] == [5, 5]
            assert [link[1:] for link in links] == [
                (
                    "entry-one",
                    "identity-preserved",
                    "claim-preserved",
                    "proof-preserved",
                    "verified",
                    "2026-07-11T12:00:00+00:00",
                ),
                (
                    "entry-two",
                    "identity-preserved",
                    None,
                    None,
                    "verified",
                    "2026-07-11T13:00:00+00:00",
                ),
            ]

            entry_cursor = await conn.execute("PRAGMA table_info(entries)")
            entry_columns = {str(row[1]) for row in await entry_cursor.fetchall()}
            assert LEGACY_ATPROTO_COLUMNS.isdisjoint(entry_columns)
            index_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND name IN (
                    'idx_atproto_identities_user', 'idx_atproto_identities_did'
                )
                """
            )
            assert await index_cursor.fetchall() == []

            rows_before_second_init = {}
            for table in (
                "atproto_identities",
                "user_atproto_controls",
                "profile_atproto_links",
            ):
                cursor = await conn.execute(f"SELECT * FROM {table} ORDER BY id")
                rows_before_second_init[table] = await cursor.fetchall()
        finally:
            await conn.close()

        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            for table, expected_rows in rows_before_second_init.items():
                cursor = await conn.execute(f"SELECT * FROM {table} ORDER BY id")
                assert await cursor.fetchall() == expected_rows
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_duplicate_did_uses_newest_identity_and_marks_every_control_conflict(
        self,
        tmp_path: Path,
    ) -> None:
        """Competing legacy owners should not receive an arbitrary active winner."""
        database_path = tmp_path / "conflict.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.executemany(
                """
                INSERT INTO atproto_identities (
                    id, user_id, did, current_handle, pds_url, did_resolved_at,
                    handle_verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "identity-older",
                        "user-one",
                        "did:plc:shared",
                        "old.example",
                        "https://old-pds.example",
                        "2026-07-01T12:00:00+00:00",
                        "2026-07-01T12:00:00+00:00",
                        "2026-07-01T12:00:00+00:00",
                        "2026-07-02T12:00:00+00:00",
                    ),
                    (
                        "identity-newest",
                        "user-two",
                        "did:plc:shared",
                        "new.example",
                        "https://new-pds.example",
                        "2026-07-10T12:00:00+00:00",
                        "2026-07-10T12:00:00+00:00",
                        "2026-07-03T12:00:00+00:00",
                        "2026-07-11T12:00:00+00:00",
                    ),
                ],
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            identity_cursor = await conn.execute(
                "SELECT id, current_handle, pds_url FROM atproto_identities"
            )
            assert await identity_cursor.fetchall() == [
                ("identity-newest", "new.example", "https://new-pds.example")
            ]
            controls_cursor = await conn.execute(
                """
                SELECT user_id, status
                FROM user_atproto_controls
                ORDER BY user_id
                """
            )
            assert await controls_cursor.fetchall() == [
                ("user-one", "conflict"),
                ("user-two", "conflict"),
            ]
            active_cursor = await conn.execute(
                "SELECT COUNT(*) FROM user_atproto_controls WHERE status = 'active'"
            )
            assert await active_cursor.fetchone() == (0,)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_complete_unmatched_profile_identity_requires_reverification(
        self,
        tmp_path: Path,
    ) -> None:
        """A complete legacy pair without identity provenance should remain visible to review."""
        database_path = tmp_path / "unresolved.db"
        conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_entry(
                conn,
                "entry-unresolved",
                did="did:plc:unresolved",
                handle="unresolved.example",
                verified_at="2026-07-08T12:00:00+00:00",
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            identity_cursor = await conn.execute(
                """
                SELECT id, did, current_handle, resolution_status,
                       did_resolved_at, handle_verified_at
                FROM atproto_identities
                """
            )
            identity = await identity_cursor.fetchone()
            assert identity is not None
            assert UUID(identity[0]).version == 5
            assert identity[1:] == (
                "did:plc:unresolved",
                "unresolved.example",
                "needs_attention",
                None,
                None,
            )
            link_cursor = await conn.execute(
                """
                SELECT entry_id, identity_id, status, verified_at
                FROM profile_atproto_links
                """
            )
            assert await link_cursor.fetchone() == (
                "entry-unresolved",
                identity[0],
                "reverification_required",
                "2026-07-08T12:00:00+00:00",
            )
        finally:
            await conn.close()
