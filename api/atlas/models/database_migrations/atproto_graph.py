"""The ATProto identity-graph migration itself."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .atproto_ddl import _ATPROTO_CONTROL_COLUMNS, _ATPROTO_PROFILE_LINK_COLUMNS
from .atproto_queries import (
    _create_atproto_identity_graph,
    _insert_global_identity,
    _insert_unresolved_atproto_identity,
    _load_existing_atproto_graph_rows,
    _load_global_identities,
    _load_legacy_entry_links,
    _load_legacy_identities,
    _load_matching_atproto_proofs,
    _lock_atproto_migration_sources,
    _table_count,
)
from .atproto_reconcile import (
    _conflicting_control_identity_ids,
    _deduplicate_existing_controls,
    _legacy_control_rows,
    _profile_link_row,
    _reconcile_control_conflict,
    _remap_existing_identity_id,
)
from .atproto_records import (
    _ATPROTO_MIGRATION_ADVISORY_LOCK_KEY,
    _ATPROTO_MIGRATION_SAVEPOINT,
    _LEGACY_ENTRY_ATPROTO_COLUMNS,
    _AtprotoMigrationExpectations,
    _ExistingAtprotoGraphRows,
    _GlobalAtprotoIdentity,
    _IdentityMigrationRows,
    _LegacyAtprotoIdentity,
    _LegacyEntryAtprotoLink,
    _ProfileLinkMigrationRows,
)
from .atproto_verify import _assert_atproto_migration
from .schema_introspection import _table_columns


async def migrate_atproto_identity_graph(conn: Any, *, backend: str) -> None:
    """Replace legacy user-owned identities and entry columns atomically.

    The migration keeps the durable DID and every complete profile relation so
    public identity provenance remains inspectable through handle and account
    changes. Corrupt partial profile data aborts instead of being presented as
    trusted identity evidence.

    Parameters
    ----------
    conn
        Open SQLite connection or PostgreSQL connection adapter.
    backend
        Database dialect, either ``sqlite`` or ``postgres``.
    """
    if backend not in {"sqlite", "postgres"}:
        msg = f"Unsupported database backend: {backend}"
        raise ValueError(msg)

    owns_sqlite_transaction = backend == "sqlite" and not bool(
        getattr(conn, "in_transaction", False)
    )
    if owns_sqlite_transaction:
        await conn.execute("BEGIN IMMEDIATE")

    await conn.execute(f"SAVEPOINT {_ATPROTO_MIGRATION_SAVEPOINT}")
    try:
        await _migrate_atproto_identity_graph(conn, backend=backend)
    except Exception:
        await conn.execute(f"ROLLBACK TO SAVEPOINT {_ATPROTO_MIGRATION_SAVEPOINT}")
        await conn.execute(f"RELEASE SAVEPOINT {_ATPROTO_MIGRATION_SAVEPOINT}")
        if owns_sqlite_transaction:
            await conn.rollback()
        raise
    await conn.execute(f"RELEASE SAVEPOINT {_ATPROTO_MIGRATION_SAVEPOINT}")
    if owns_sqlite_transaction:
        await conn.commit()


async def _migrate_atproto_identity_graph(conn: Any, *, backend: str) -> None:
    if backend == "postgres":
        await conn.execute(
            "SELECT pg_advisory_xact_lock(?)",
            (_ATPROTO_MIGRATION_ADVISORY_LOCK_KEY,),
        )
    identity_columns = await _table_columns(conn, "atproto_identities", backend=backend)
    entry_columns = await _table_columns(conn, "entries", backend=backend)
    control_columns = await _table_columns(conn, "user_atproto_controls", backend=backend)
    profile_link_columns = await _table_columns(conn, "profile_atproto_links", backend=backend)
    claim_columns = await _table_columns(conn, "profile_claims", backend=backend)
    proof_columns = await _table_columns(conn, "profile_claim_proofs", backend=backend)
    legacy_entry_columns = set(_LEGACY_ENTRY_ATPROTO_COLUMNS) & entry_columns
    has_legacy_identities = "user_id" in identity_columns
    has_global_identities = "resolution_status" in identity_columns

    if identity_columns and not has_legacy_identities and not has_global_identities:
        msg = "Unrecognized atproto_identities schema; migration stopped before changing data"
        raise RuntimeError(msg)
    if not has_legacy_identities and not legacy_entry_columns:
        return

    await _lock_atproto_migration_sources(
        conn,
        backend=backend,
        tables=tuple(
            table
            for table, columns in (
                ("entries", entry_columns),
                ("atproto_identities", identity_columns),
                ("profile_atproto_links", profile_link_columns),
                ("user_atproto_controls", control_columns),
                ("profile_claims", claim_columns),
                ("profile_claim_proofs", proof_columns),
            )
            if columns
        ),
    )
    existing_graph_rows = (
        await _load_existing_atproto_graph_rows(
            conn,
            control_columns=control_columns,
            profile_link_columns=profile_link_columns,
        )
        if has_legacy_identities
        else _ExistingAtprotoGraphRows([], [])
    )
    legacy_links = await _load_legacy_entry_links(
        conn,
        entry_columns=entry_columns,
    )
    legacy_identities = await _load_legacy_identities(conn) if has_legacy_identities else []
    proof_links = await _load_matching_atproto_proofs(
        conn,
        claim_columns=claim_columns,
        proof_columns=proof_columns,
    )

    if has_legacy_identities:
        await _drop_existing_atproto_graph_children(
            conn,
            has_controls=bool(control_columns),
            has_profile_links=bool(profile_link_columns),
        )
        await _archive_legacy_atproto_identities(conn, backend=backend)
    await _create_atproto_identity_graph(conn, backend=backend)
    identity_count_before = await _table_count(conn, "atproto_identities")
    control_count_before = await _table_count(conn, "user_atproto_controls")
    link_count_before = await _table_count(conn, "profile_atproto_links")
    identity_rows = await _migrate_legacy_identity_rows(conn, legacy_identities)
    restored_graph_rows, reconciled_legacy_controls = await _restore_existing_atproto_graph_rows(
        conn,
        rows=existing_graph_rows,
        identity_id_map=identity_rows.identity_id_map,
        legacy_controls=identity_rows.controls,
    )
    migrated_controls = await _insert_missing_legacy_control_rows(
        conn,
        reconciled_legacy_controls,
    )
    profile_rows = await _migrate_legacy_profile_link_rows(
        conn,
        legacy_links=legacy_links,
        proof_links=proof_links,
    )
    expected_identities = identity_rows.identities | profile_rows.identities
    expected_controls = restored_graph_rows.controls + migrated_controls
    expected_links = restored_graph_rows.links + profile_rows.links
    await _assert_atproto_migration(
        conn,
        _AtprotoMigrationExpectations(
            identity_count=identity_count_before + len(expected_identities),
            control_count=control_count_before + len(expected_controls),
            link_count=link_count_before + len(expected_links),
            identities=expected_identities,
            controls=expected_controls,
            links=expected_links,
        ),
    )
    await _remove_legacy_atproto_storage(
        conn,
        backend=backend,
        legacy_entry_columns=legacy_entry_columns,
        has_legacy_identities=has_legacy_identities,
    )


async def _archive_legacy_atproto_identities(
    conn: Any,
    *,
    backend: str,
) -> None:
    archived_columns = await _table_columns(
        conn,
        "atproto_identities_legacy",
        backend=backend,
    )
    if archived_columns:
        msg = "Legacy ATProto identity archive already exists; migration cannot prove ownership"
        raise RuntimeError(msg)
    await conn.execute("DROP INDEX IF EXISTS idx_atproto_identities_user")
    await conn.execute("DROP INDEX IF EXISTS idx_atproto_identities_did")
    await conn.execute("ALTER TABLE atproto_identities RENAME TO atproto_identities_legacy")


async def _drop_existing_atproto_graph_children(
    conn: Any,
    *,
    has_controls: bool,
    has_profile_links: bool,
) -> None:
    if has_profile_links:
        await conn.execute("DROP TABLE profile_atproto_links")
    if has_controls:
        await conn.execute("DROP TABLE user_atproto_controls")


async def _restore_existing_atproto_graph_rows(
    conn: Any,
    *,
    rows: _ExistingAtprotoGraphRows,
    identity_id_map: dict[str, str],
    legacy_controls: list[tuple[Any, ...]],
) -> tuple[_ExistingAtprotoGraphRows, list[tuple[Any, ...]]]:
    restored_controls = _deduplicate_existing_controls(
        [
            _remap_existing_identity_id(row, identity_id_map=identity_id_map, identity_index=1)
            for row in rows.controls
        ]
    )
    conflicting_identity_ids = _conflicting_control_identity_ids(
        [*restored_controls, *legacy_controls]
    )
    restored_controls = [
        _reconcile_control_conflict(row, conflicting_identity_ids=conflicting_identity_ids)
        for row in restored_controls
    ]
    reconciled_legacy_controls = [
        _reconcile_control_conflict(row, conflicting_identity_ids=conflicting_identity_ids)
        for row in legacy_controls
    ]
    restored_links = [
        _remap_existing_identity_id(row, identity_id_map=identity_id_map, identity_index=2)
        for row in rows.links
    ]
    for control in restored_controls:
        await conn.execute(
            f"INSERT INTO user_atproto_controls ({', '.join(_ATPROTO_CONTROL_COLUMNS)}) "
            f"VALUES ({', '.join('?' for _ in _ATPROTO_CONTROL_COLUMNS)})",
            control,
        )
    for link in restored_links:
        await conn.execute(
            f"INSERT INTO profile_atproto_links ({', '.join(_ATPROTO_PROFILE_LINK_COLUMNS)}) "
            f"VALUES ({', '.join('?' for _ in _ATPROTO_PROFILE_LINK_COLUMNS)})",
            link,
        )
    return _ExistingAtprotoGraphRows(restored_controls, restored_links), reconciled_legacy_controls


async def _migrate_legacy_identity_rows(
    conn: Any,
    legacy_identities: list[_LegacyAtprotoIdentity],
) -> _IdentityMigrationRows:
    grouped_identities: dict[str, list[_LegacyAtprotoIdentity]] = defaultdict(list)
    for identity in legacy_identities:
        grouped_identities[identity.did].append(identity)

    expected_identities: dict[str, _GlobalAtprotoIdentity] = {}
    expected_controls: list[tuple[Any, ...]] = []
    identity_id_map: dict[str, str] = {}
    for did, identities in grouped_identities.items():
        canonical = identities[0]
        global_identity = _GlobalAtprotoIdentity(
            id=canonical.id,
            did=did,
            current_handle=canonical.current_handle,
            pds_url=canonical.pds_url,
            resolution_status="verified",
            did_resolved_at=canonical.did_resolved_at,
            handle_verified_at=canonical.handle_verified_at,
            last_resolution_error=None,
            created_at=canonical.created_at,
            updated_at=canonical.updated_at,
        )
        await _insert_global_identity(conn, global_identity)
        expected_identities[did] = global_identity
        identity_id_map.update({identity.id: global_identity.id for identity in identities})
        controls = _legacy_control_rows(global_identity, identities)
        expected_controls.extend(controls)
    return _IdentityMigrationRows(expected_identities, expected_controls, identity_id_map)


async def _insert_missing_legacy_control_rows(
    conn: Any,
    controls: list[tuple[Any, ...]],
) -> list[tuple[Any, ...]]:
    inserted: list[tuple[Any, ...]] = []
    for control in controls:
        cursor = await conn.execute(
            """
            SELECT id
            FROM user_atproto_controls
            WHERE identity_id = ? AND user_id = ?
            """,
            (control[1], control[2]),
        )
        if await cursor.fetchone() is not None:
            continue
        await conn.execute(
            """
            INSERT INTO user_atproto_controls (
                id, identity_id, user_id, status, verified_at,
                disconnected_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            control,
        )
        inserted.append(control)
    return inserted


async def _migrate_legacy_profile_link_rows(
    conn: Any,
    *,
    legacy_links: list[_LegacyEntryAtprotoLink],
    proof_links: dict[tuple[str, str, str], tuple[str, str]],
) -> _ProfileLinkMigrationRows:
    stored_identities = await _load_global_identities(conn)
    expected_identities: dict[str, _GlobalAtprotoIdentity] = {}
    expected_links: list[tuple[Any, ...]] = []
    for legacy_link in legacy_links:
        identity = stored_identities.get(legacy_link.did)
        if identity is None:
            identity = await _insert_unresolved_atproto_identity(conn, legacy_link)
            stored_identities[identity.did] = identity
            expected_identities[identity.did] = identity
        link = _profile_link_row(identity, legacy_link, proof_links)
        cursor = await conn.execute(
            """
            SELECT identity_id
            FROM profile_atproto_links
            WHERE entry_id = ? AND status <> 'removed'
            """,
            (link[1],),
        )
        existing_link = await cursor.fetchone()
        if existing_link is not None and existing_link[0] == link[2]:
            continue
        if existing_link is not None:
            msg = f"Existing ATProto profile link conflicts with legacy entry {link[1]}"
            raise RuntimeError(msg)
        await conn.execute(
            """
            INSERT INTO profile_atproto_links (
                id, entry_id, identity_id, claim_id, proof_id, status,
                verified_at, last_checked_at, removed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            link,
        )
        expected_links.append(link)
    return _ProfileLinkMigrationRows(expected_identities, expected_links)


async def _remove_legacy_atproto_storage(
    conn: Any,
    *,
    backend: str,
    legacy_entry_columns: set[str],
    has_legacy_identities: bool,
) -> None:
    for column in _LEGACY_ENTRY_ATPROTO_COLUMNS:
        if column not in legacy_entry_columns:
            continue
        if backend == "postgres":
            await conn.execute(f"ALTER TABLE entries DROP COLUMN IF EXISTS {column}")
        else:
            await conn.execute(f"ALTER TABLE entries DROP COLUMN {column}")
    if has_legacy_identities:
        await conn.execute("DROP TABLE atproto_identities_legacy")
