"""ATProto identity graph migration: partial graph cases."""

from __future__ import annotations

from typing import TYPE_CHECKING

import aiosqlite
import pytest

from atlas.models.database import (
    init_db,
)
from atlas.models.database_migrations import (
    _migration_id,
)

if TYPE_CHECKING:
    from pathlib import Path

from tests.platform.test_database_schema_migrations.support import (
    LEGACY_ATPROTO_COLUMNS,
    TIMESTAMP,
    _create_partial_atproto_graph,
    _insert_legacy_identity_link,
    _insert_partial_atproto_control,
    _insert_partial_atproto_link,
    _legacy_database,
)


class TestMigrateAtprotoIdentityGraph:
    @pytest.mark.asyncio
    async def test_partial_graph_rows_survive_with_final_foreign_keys(
        self,
        tmp_path: Path,
    ) -> None:
        """A partial deployment should preserve child rows and repair their parent FKs."""
        database_path = tmp_path / "partial-graph.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            identity_id, user_id, entry_id = await _insert_legacy_identity_link(
                conn,
                key="partial-graph",
                did="did:plc:partial-graph",
                handle="partial.example",
                pds_url="https://pds.example",
            )
            await _create_partial_atproto_graph(conn)
            control_id = await _insert_partial_atproto_control(
                conn,
                identity_id=identity_id,
                user_id=user_id,
            )
            link_id = await _insert_partial_atproto_link(
                conn,
                identity_id=identity_id,
                entry_id=entry_id,
            )
            await conn.commit()
        finally:
            await conn.close()

        db_url = f"sqlite:///{database_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            control_cursor = await conn.execute(
                """
                SELECT id, identity_id, user_id, status
                FROM user_atproto_controls
                """
            )
            assert await control_cursor.fetchall() == [(control_id, identity_id, user_id, "active")]
            link_cursor = await conn.execute(
                """
                SELECT id, entry_id, identity_id, status
                FROM profile_atproto_links
                """
            )
            assert await link_cursor.fetchall() == [
                (
                    link_id,
                    entry_id,
                    identity_id,
                    "verified",
                )
            ]

            control_fk_cursor = await conn.execute("PRAGMA foreign_key_list(user_atproto_controls)")
            control_fk_targets = {str(row[2]) for row in await control_fk_cursor.fetchall()}
            assert control_fk_targets == {"atproto_identities"}
            link_fk_cursor = await conn.execute("PRAGMA foreign_key_list(profile_atproto_links)")
            link_fk_targets = {str(row[2]) for row in await link_fk_cursor.fetchall()}
            assert "atproto_identities" in link_fk_targets
            assert "atproto_identities_legacy" not in link_fk_targets
            fk_check_cursor = await conn.execute("PRAGMA foreign_key_check")
            assert await fk_check_cursor.fetchall() == []
            archive_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'atproto_identities_legacy'
                """
            )
            assert await archive_cursor.fetchone() is None
        finally:
            await conn.close()

        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            control_cursor = await conn.execute("SELECT id FROM user_atproto_controls")
            assert await control_cursor.fetchall() == [(control_id,)]
            link_cursor = await conn.execute("SELECT id FROM profile_atproto_links")
            assert await link_cursor.fetchall() == [(link_id,)]
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_partial_graph_duplicate_did_controls_become_conflicts(
        self,
        tmp_path: Path,
    ) -> None:
        """Collapsed partial controls should preserve both users without an active winner."""
        database_path = tmp_path / "partial-conflict.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            old_identity_id, old_user_id, old_entry_id = await _insert_legacy_identity_link(
                conn,
                key="shared-a",
                did="did:plc:partial-shared",
                handle="shared.example",
            )
            new_identity_id, new_user_id, _ = await _insert_legacy_identity_link(
                conn,
                key="shared-z",
                did="did:plc:partial-shared",
                handle="shared.example",
            )
            await _create_partial_atproto_graph(conn)
            old_control_id = await _insert_partial_atproto_control(
                conn,
                identity_id=old_identity_id,
                user_id=old_user_id,
            )
            new_control_id = await _insert_partial_atproto_control(
                conn,
                identity_id=new_identity_id,
                user_id=new_user_id,
            )
            observer_user_id = "user-observer"
            await _insert_partial_atproto_control(
                conn,
                identity_id=old_identity_id,
                user_id=observer_user_id,
                status="disconnected",
            )
            observer_control_id = await _insert_partial_atproto_control(
                conn,
                identity_id=new_identity_id,
                user_id=observer_user_id,
                status="disconnected",
            )
            link_id = await _insert_partial_atproto_link(
                conn,
                identity_id=old_identity_id,
                entry_id=old_entry_id,
            )
            await conn.commit()
        finally:
            await conn.close()

        db_url = f"sqlite:///{database_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            controls_cursor = await conn.execute(
                """
                SELECT id, identity_id, user_id, status, created_at, updated_at
                FROM user_atproto_controls
                ORDER BY user_id
                """
            )
            assert await controls_cursor.fetchall() == [
                (
                    observer_control_id,
                    new_identity_id,
                    observer_user_id,
                    "disconnected",
                    TIMESTAMP,
                    TIMESTAMP,
                ),
                (
                    old_control_id,
                    new_identity_id,
                    old_user_id,
                    "conflict",
                    TIMESTAMP,
                    TIMESTAMP,
                ),
                (
                    new_control_id,
                    new_identity_id,
                    new_user_id,
                    "conflict",
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            ]
            link_cursor = await conn.execute(
                """
                SELECT id, entry_id, identity_id, status
                FROM profile_atproto_links
                WHERE id = ?
                """,
                (link_id,),
            )
            assert await link_cursor.fetchone() == (
                link_id,
                old_entry_id,
                new_identity_id,
                "verified",
            )
            fk_cursor = await conn.execute("PRAGMA foreign_key_check")
            assert await fk_cursor.fetchall() == []
            entry_columns_cursor = await conn.execute("PRAGMA table_info(entries)")
            entry_columns = {str(row[1]) for row in await entry_columns_cursor.fetchall()}
            assert LEGACY_ATPROTO_COLUMNS.isdisjoint(entry_columns)
            archive_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'atproto_identities_legacy'
                """
            )
            assert await archive_cursor.fetchone() is None
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
    @pytest.mark.parametrize(
        ("restored_status", "expected_restored_status", "expected_owner_status"),
        [
            ("active", "conflict", "conflict"),
            ("disconnected", "disconnected", "active"),
        ],
    )
    async def test_partial_graph_restored_controller_conflicts_with_legacy_owner(
        self,
        tmp_path: Path,
        restored_status: str,
        expected_restored_status: str,
        expected_owner_status: str,
    ) -> None:
        """Only current restored controllers should conflict with the legacy owner."""
        database_path = tmp_path / "partial-restored-controller.db"
        conn = await _legacy_database(database_path)
        try:
            identity_id, owner_user_id, entry_id = await _insert_legacy_identity_link(
                conn,
                key="union-owner",
                did="did:plc:union-owner",
                handle="union.example",
            )
            await _create_partial_atproto_graph(conn)
            restored_user_id = "user-restored-controller"
            restored_control_id = await _insert_partial_atproto_control(
                conn,
                identity_id=identity_id,
                user_id=restored_user_id,
                status=restored_status,
            )
            link_id = await _insert_partial_atproto_link(
                conn,
                identity_id=identity_id,
                entry_id=entry_id,
            )
            await conn.commit()
        finally:
            await conn.close()

        db_url = f"sqlite:///{database_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            controls_cursor = await conn.execute(
                """
                SELECT id, identity_id, user_id, status, created_at, updated_at
                FROM user_atproto_controls
                ORDER BY user_id
                """
            )
            owner_control_id = _migration_id("control", identity_id, owner_user_id)
            assert await controls_cursor.fetchall() == [
                (
                    restored_control_id,
                    identity_id,
                    restored_user_id,
                    expected_restored_status,
                    TIMESTAMP,
                    TIMESTAMP,
                ),
                (
                    owner_control_id,
                    identity_id,
                    owner_user_id,
                    expected_owner_status,
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            ]
            link_cursor = await conn.execute(
                "SELECT id, identity_id FROM profile_atproto_links WHERE id = ?",
                (link_id,),
            )
            assert await link_cursor.fetchone() == (link_id, identity_id)
            fk_cursor = await conn.execute("PRAGMA foreign_key_check")
            assert await fk_cursor.fetchall() == []
            entry_columns_cursor = await conn.execute("PRAGMA table_info(entries)")
            entry_columns = {str(row[1]) for row in await entry_columns_cursor.fetchall()}
            assert LEGACY_ATPROTO_COLUMNS.isdisjoint(entry_columns)
            archive_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'atproto_identities_legacy'
                """
            )
            assert await archive_cursor.fetchone() is None
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
