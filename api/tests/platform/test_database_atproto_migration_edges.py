"""Defensive branch coverage for the ATProto identity-graph migration."""

from __future__ import annotations

from typing import Any

import aiosqlite
import pytest

from atlas.models import database_migrations as migrations


class _Cursor:
    def __init__(self, *, one: Any = None, all_rows: list[tuple[Any, ...]] | None = None) -> None:
        self.one = one
        self.all_rows = all_rows or []

    async def fetchone(self) -> Any:
        return self.one

    async def fetchall(self) -> list[tuple[Any, ...]]:
        return self.all_rows


class _Connection:
    def __init__(self, cursors: list[_Cursor] | None = None) -> None:
        self.cursors = list(cursors or [])
        self.statements: list[str] = []
        self.in_transaction = True
        self.rolled_back = False

    async def execute(self, statement: str, _params: object = None) -> _Cursor:
        self.statements.append(statement)
        return self.cursors.pop(0) if self.cursors else _Cursor()

    async def rollback(self) -> None:
        self.rolled_back = True

    async def commit(self) -> None:
        return None


@pytest.mark.asyncio
async def test_migration_rejects_unknown_backend() -> None:
    with pytest.raises(ValueError, match="Unsupported database backend"):
        await migrations.migrate_atproto_identity_graph(_Connection(), backend="other")


@pytest.mark.asyncio
async def test_sqlite_migration_rolls_back_a_transaction_it_opened_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()
    conn.in_transaction = False

    async def failed_graph_migration(*_args: object, **_kwargs: object) -> None:
        msg = "simulated migration failure"
        raise RuntimeError(msg)

    monkeypatch.setattr(migrations, "_migrate_atproto_identity_graph", failed_graph_migration)
    with pytest.raises(RuntimeError, match="simulated migration failure"):
        await migrations.migrate_atproto_identity_graph(conn, backend="sqlite")

    assert conn.rolled_back


@pytest.mark.asyncio
async def test_sqlite_migration_preserves_the_callers_transaction_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()

    async def failed_graph_migration(*_args: object, **_kwargs: object) -> None:
        msg = "simulated migration failure"
        raise RuntimeError(msg)

    monkeypatch.setattr(migrations, "_migrate_atproto_identity_graph", failed_graph_migration)
    with pytest.raises(RuntimeError, match="simulated migration failure"):
        await migrations.migrate_atproto_identity_graph(conn, backend="sqlite")

    assert not conn.rolled_back


@pytest.mark.asyncio
async def test_postgres_migration_acquires_the_transaction_advisory_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()

    async def global_identity_columns(_conn: object, table: str, *, backend: str) -> set[str]:
        assert backend == "postgres"
        return {"resolution_status"} if table == "atproto_identities" else set()

    monkeypatch.setattr(migrations, "_table_columns", global_identity_columns)
    await migrations._migrate_atproto_identity_graph(conn, backend="postgres")

    assert conn.statements == ["SELECT pg_advisory_xact_lock(?)"]


@pytest.mark.asyncio
async def test_postgres_migration_helpers_use_information_schema_and_safe_ddl() -> None:
    columns_conn = _Connection([_Cursor(all_rows=[("id",), ("linked_atproto_did",)])])
    assert await migrations._table_columns(columns_conn, "entries", backend="postgres") == {
        "id",
        "linked_atproto_did",
    }
    assert "information_schema.columns" in columns_conn.statements[0]

    removal_conn = _Connection()
    await migrations._remove_legacy_atproto_storage(
        removal_conn,
        backend="postgres",
        legacy_entry_columns={"linked_atproto_did"},
        has_legacy_identities=False,
    )
    assert removal_conn.statements == [
        "ALTER TABLE entries DROP COLUMN IF EXISTS linked_atproto_did"
    ]

    lock_conn = _Connection()
    await migrations._lock_atproto_migration_sources(
        lock_conn, backend="postgres", tables=("entries", "atproto_identities")
    )
    assert lock_conn.statements == [
        "LOCK TABLE entries, atproto_identities IN ACCESS EXCLUSIVE MODE"
    ]


@pytest.mark.asyncio
async def test_migration_rejects_unrecognized_source_schemas(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def columns(_conn: object, table: str, *, backend: str) -> set[str]:
        del backend
        return {"id"} if table == "atproto_identities" else set()

    monkeypatch.setattr(migrations, "_table_columns", columns)
    with pytest.raises(RuntimeError, match="Unrecognized atproto_identities"):
        await migrations._migrate_atproto_identity_graph(_Connection(), backend="sqlite")

    async def archived(_conn: object, _table: str, *, backend: str) -> set[str]:
        del backend
        return {"id"}

    monkeypatch.setattr(migrations, "_table_columns", archived)
    with pytest.raises(RuntimeError, match="archive already exists"):
        await migrations._archive_legacy_atproto_identities(_Connection(), backend="sqlite")

    with pytest.raises(RuntimeError, match="user_atproto_controls"):
        await migrations._load_existing_atproto_graph_rows(
            _Connection(), control_columns={"bad"}, profile_link_columns=set()
        )
    with pytest.raises(RuntimeError, match="profile_atproto_links"):
        await migrations._load_existing_atproto_graph_rows(
            _Connection(),
            control_columns=set(),
            profile_link_columns={"bad"},
        )


def test_existing_graph_reconciliation_edges() -> None:
    first = ("nonpreferred", "identity", "user", "active", None, None, "a", "a")
    preferred_id = migrations._migration_id("control", "identity", "user")
    preferred = (preferred_id, "identity", "user", "active", None, None, "b", "b")
    assert migrations._deduplicate_existing_controls([first, preferred]) == [preferred]
    with pytest.raises(RuntimeError, match="unknown identity"):
        migrations._remap_existing_identity_id(first, identity_id_map={}, identity_index=1)


@pytest.mark.asyncio
async def test_profile_link_migration_rejects_conflicting_existing_relation() -> None:
    link = migrations._LegacyEntryAtprotoLink(
        entry_id="entry",
        did="did:plc:legacy",
        handle="legacy.example",
        verified_at="now",
        created_at="now",
        updated_at="now",
    )
    conn = _Connection(
        [
            _Cursor(all_rows=[]),
            _Cursor(),
            _Cursor(one=("different-identity",)),
        ]
    )
    with pytest.raises(RuntimeError, match="conflicts with legacy entry"):
        await migrations._migrate_legacy_profile_link_rows(
            conn, legacy_links=[link], proof_links={}
        )


@pytest.mark.asyncio
async def test_remove_legacy_storage_skips_absent_columns_and_archive() -> None:
    conn = _Connection()
    await migrations._remove_legacy_atproto_storage(
        conn,
        backend="sqlite",
        legacy_entry_columns=set(),
        has_legacy_identities=False,
    )
    assert conn.statements == []


@pytest.mark.asyncio
async def test_migration_builds_graph_from_entry_columns_without_legacy_identity_table() -> None:
    async with aiosqlite.connect(":memory:") as conn:
        await conn.execute(
            """
            CREATE TABLE entries (
                id TEXT PRIMARY KEY,
                linked_atproto_did TEXT,
                linked_atproto_handle TEXT,
                linked_atproto_verified_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        await migrations.migrate_atproto_identity_graph(conn, backend="sqlite")
        columns = await migrations._table_columns(conn, "atproto_identities", backend="sqlite")
        assert "resolution_status" in columns


@pytest.mark.asyncio
async def test_legacy_loaders_reject_corrupt_rows_and_ignore_empty_values() -> None:
    missing_id = _Connection([_Cursor(all_rows=[("", "user", "did", "handle", None, 1, 1, 1, 1)])])
    with pytest.raises(RuntimeError, match="missing identifier"):
        await migrations._load_legacy_identities(missing_id)

    missing_time = _Connection(
        [_Cursor(all_rows=[("id", "user", "did", "handle", None, None, None, 1, 1)])]
    )
    with pytest.raises(RuntimeError, match="missing audit timestamps"):
        await migrations._load_legacy_identities(missing_time)

    assert await migrations._load_legacy_entry_links(_Connection(), entry_columns=set()) == []
    empty = _Connection([_Cursor(all_rows=[("entry", None, None, None, 1, 1)])])
    assert (
        await migrations._load_legacy_entry_links(empty, entry_columns={"id", "updated_at"}) == []
    )
    missing_link_time = _Connection([_Cursor(all_rows=[("entry", "did", "handle", None, None, 1)])])
    with pytest.raises(RuntimeError, match="missing audit timestamps"):
        await migrations._load_legacy_entry_links(
            missing_link_time,
            entry_columns={"id", *migrations._LEGACY_ENTRY_ATPROTO_COLUMNS, "updated_at"},
        )


@pytest.mark.asyncio
async def test_proof_loader_filters_malformed_metadata() -> None:
    assert (
        await migrations._load_matching_atproto_proofs(
            _Connection(), claim_columns=set(), proof_columns=set()
        )
        == {}
    )
    rows = [
        ("e", "c", "p1", 42),
        ("e", "c", "p2", "{"),
        ("e", "c", "p3", "[]"),
        ("e", "c", "p4", '{"did":"","handle":"h"}'),
    ]
    conn = _Connection([_Cursor(all_rows=rows)])
    assert (
        await migrations._load_matching_atproto_proofs(
            conn, claim_columns={"id"}, proof_columns={"id"}
        )
        == {}
    )


def _identity() -> migrations._GlobalAtprotoIdentity:
    return migrations._GlobalAtprotoIdentity(
        id="identity",
        did="did:plc:test",
        current_handle="test.example",
        pds_url=None,
        resolution_status="verified",
        did_resolved_at="now",
        handle_verified_at="now",
        last_resolution_error=None,
        created_at="now",
        updated_at="now",
    )


@pytest.mark.asyncio
async def test_migration_assertions_report_each_invariant() -> None:
    with pytest.raises(RuntimeError, match="row-count mismatch"):
        await migrations._assert_atproto_migration(
            _Connection([_Cursor(one=(0,)), _Cursor(one=(0,)), _Cursor(one=(0,))]),
            migrations._AtprotoMigrationExpectations(1, 0, 0, {}, [], []),
        )

    identity = _identity()
    with pytest.raises(RuntimeError, match="data mismatch for DID"):
        await migrations._assert_atproto_migration(
            _Connection(
                [_Cursor(one=(1,)), _Cursor(one=(0,)), _Cursor(one=(0,)), _Cursor(one=None)]
            ),
            migrations._AtprotoMigrationExpectations(1, 0, 0, {identity.did: identity}, [], []),
        )

    control = ("control", "identity", "user", "active", None, None, "now", "now")
    with pytest.raises(RuntimeError, match="control migration data mismatch"):
        await migrations._assert_atproto_migration(
            _Connection(
                [_Cursor(one=(0,)), _Cursor(one=(1,)), _Cursor(one=(0,)), _Cursor(one=None)]
            ),
            migrations._AtprotoMigrationExpectations(0, 1, 0, {}, [control], []),
        )

    link = ("link", "entry", "identity", None, None, "verified", "now", "now", None, "now", "now")
    with pytest.raises(RuntimeError, match="profile-link migration data mismatch"):
        await migrations._assert_atproto_migration(
            _Connection(
                [_Cursor(one=(0,)), _Cursor(one=(0,)), _Cursor(one=(1,)), _Cursor(one=None)]
            ),
            migrations._AtprotoMigrationExpectations(0, 0, 1, {}, [], [link]),
        )

    with pytest.raises(RuntimeError, match="Could not count migration table"):
        await migrations._table_count(_Connection([_Cursor(one=None)]), "missing")
