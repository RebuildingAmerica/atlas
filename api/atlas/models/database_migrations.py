"""Database manager and SQLite migration helpers."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

__all__ = [
    "DatabaseManager",
    "_ensure_discovery_job_columns",
    "_ensure_discovery_run_columns",
    "_ensure_entry_columns",
    "_ensure_org_annotation_columns",
    "_ensure_org_coverage_target_columns",
    "_ensure_place_context_columns",
    "_ensure_place_related_place_columns",
    "_ensure_review_queue_columns",
    "db",
    "migrate_atproto_identity_graph",
]


class DatabaseManager:
    """Helper class for database operations."""

    @staticmethod
    def generate_uuid() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def now_iso() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def encode_json(data: object) -> str:
        return json.dumps(data)

    @staticmethod
    def decode_json(data: str) -> object:
        return json.loads(data)


# Export manager for use in CRUD operations
db = DatabaseManager()

_LEGACY_ENTRY_ATPROTO_COLUMNS = (
    "linked_atproto_did",
    "linked_atproto_handle",
    "linked_atproto_verified_at",
)
_ATPROTO_MIGRATION_SAVEPOINT = "migrate_atproto_identity_graph"


@dataclass(frozen=True, slots=True)
class _LegacyAtprotoIdentity:
    id: str
    user_id: str
    did: str
    current_handle: str
    pds_url: str | None
    did_resolved_at: Any
    handle_verified_at: Any
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class _GlobalAtprotoIdentity:
    id: str
    did: str
    current_handle: str
    pds_url: str | None
    resolution_status: str
    did_resolved_at: Any
    handle_verified_at: Any
    last_resolution_error: str | None
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class _LegacyEntryAtprotoLink:
    entry_id: str
    did: str
    handle: str
    verified_at: Any
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class _IdentityMigrationRows:
    identities: dict[str, _GlobalAtprotoIdentity]
    controls: list[tuple[Any, ...]]
    identity_id_map: dict[str, str]


@dataclass(frozen=True, slots=True)
class _ProfileLinkMigrationRows:
    identities: dict[str, _GlobalAtprotoIdentity]
    links: list[tuple[Any, ...]]


@dataclass(frozen=True, slots=True)
class _ExistingAtprotoGraphRows:
    controls: list[tuple[Any, ...]]
    links: list[tuple[Any, ...]]


@dataclass(frozen=True, slots=True)
class _AtprotoMigrationExpectations:
    identity_count: int
    control_count: int
    link_count: int
    identities: dict[str, _GlobalAtprotoIdentity]
    controls: list[tuple[Any, ...]]
    links: list[tuple[Any, ...]]


_ATPROTO_GRAPH_SQLITE_DDL = (
    """
    CREATE TABLE IF NOT EXISTS atproto_identities (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        current_handle TEXT NOT NULL,
        pds_url TEXT,
        resolution_status TEXT NOT NULL DEFAULT 'verified'
            CHECK(resolution_status IN ('verified', 'needs_attention')),
        did_resolved_at TEXT,
        handle_verified_at TEXT,
        last_resolution_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(did)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_atproto_controls (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'disconnected', 'conflict')),
        verified_at TEXT,
        disconnected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, identity_id),
        FOREIGN KEY (identity_id) REFERENCES atproto_identities(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_atproto_links (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        claim_id TEXT,
        proof_id TEXT,
        status TEXT NOT NULL
            CHECK(status IN ('verified', 'reverification_required', 'removed')),
        verified_at TEXT,
        last_checked_at TEXT,
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
        FOREIGN KEY (identity_id) REFERENCES atproto_identities(id) ON DELETE CASCADE,
        FOREIGN KEY (claim_id) REFERENCES profile_claims(id) ON DELETE SET NULL,
        FOREIGN KEY (proof_id) REFERENCES profile_claim_proofs(id) ON DELETE SET NULL
    )
    """,
)

_ATPROTO_GRAPH_POSTGRES_DDL = (
    """
    CREATE TABLE IF NOT EXISTS atproto_identities (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        current_handle TEXT NOT NULL,
        pds_url TEXT,
        resolution_status TEXT NOT NULL DEFAULT 'verified'
            CHECK(resolution_status IN ('verified', 'needs_attention')),
        did_resolved_at TIMESTAMPTZ,
        handle_verified_at TIMESTAMPTZ,
        last_resolution_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(did)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_atproto_controls (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL REFERENCES atproto_identities(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'disconnected', 'conflict')),
        verified_at TIMESTAMPTZ,
        disconnected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(user_id, identity_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_atproto_links (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        identity_id TEXT NOT NULL REFERENCES atproto_identities(id) ON DELETE CASCADE,
        claim_id TEXT REFERENCES profile_claims(id) ON DELETE SET NULL,
        proof_id TEXT REFERENCES profile_claim_proofs(id) ON DELETE SET NULL,
        status TEXT NOT NULL
            CHECK(status IN ('verified', 'reverification_required', 'removed')),
        verified_at TIMESTAMPTZ,
        last_checked_at TIMESTAMPTZ,
        removed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
    )
    """,
)

_ATPROTO_GRAPH_INDEX_DDL = (
    "CREATE INDEX IF NOT EXISTS idx_user_atproto_controls_user ON user_atproto_controls(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_user_atproto_controls_identity "
    "ON user_atproto_controls(identity_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_atproto_controls_active_identity "
    "ON user_atproto_controls(identity_id) WHERE status = 'active'",
    "CREATE INDEX IF NOT EXISTS idx_profile_atproto_links_identity "
    "ON profile_atproto_links(identity_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_atproto_links_non_removed_entry "
    "ON profile_atproto_links(entry_id) WHERE status <> 'removed'",
)

_ATPROTO_CONTROL_COLUMNS = (
    "id",
    "identity_id",
    "user_id",
    "status",
    "verified_at",
    "disconnected_at",
    "created_at",
    "updated_at",
)
_ATPROTO_PROFILE_LINK_COLUMNS = (
    "id",
    "entry_id",
    "identity_id",
    "claim_id",
    "proof_id",
    "status",
    "verified_at",
    "last_checked_at",
    "removed_at",
    "created_at",
    "updated_at",
)


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
    restored_graph_rows = await _restore_existing_atproto_graph_rows(
        conn,
        rows=existing_graph_rows,
        identity_id_map=identity_rows.identity_id_map,
        conflicting_identity_ids={
            control[1] for control in identity_rows.controls if control[3] == "conflict"
        },
    )
    migrated_controls = await _insert_missing_legacy_control_rows(
        conn,
        identity_rows.controls,
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


async def _load_existing_atproto_graph_rows(
    conn: Any,
    *,
    control_columns: set[str],
    profile_link_columns: set[str],
) -> _ExistingAtprotoGraphRows:
    controls: list[tuple[Any, ...]] = []
    links: list[tuple[Any, ...]] = []
    if control_columns:
        if control_columns != set(_ATPROTO_CONTROL_COLUMNS):
            msg = "Unrecognized user_atproto_controls schema; migration stopped before changes"
            raise RuntimeError(msg)
        cursor = await conn.execute(
            f"SELECT {', '.join(_ATPROTO_CONTROL_COLUMNS)} FROM user_atproto_controls ORDER BY id"
        )
        controls = await cursor.fetchall()
    if profile_link_columns:
        if profile_link_columns != set(_ATPROTO_PROFILE_LINK_COLUMNS):
            msg = "Unrecognized profile_atproto_links schema; migration stopped before changes"
            raise RuntimeError(msg)
        cursor = await conn.execute(
            f"SELECT {', '.join(_ATPROTO_PROFILE_LINK_COLUMNS)} "
            "FROM profile_atproto_links ORDER BY id"
        )
        links = await cursor.fetchall()
    return _ExistingAtprotoGraphRows(controls, links)


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
    conflicting_identity_ids: set[str],
) -> _ExistingAtprotoGraphRows:
    restored_controls = _deduplicate_existing_controls(
        [
            _reconcile_existing_control(
                row,
                identity_id_map=identity_id_map,
                conflicting_identity_ids=conflicting_identity_ids,
            )
            for row in rows.controls
        ]
    )
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
    return _ExistingAtprotoGraphRows(restored_controls, restored_links)


def _deduplicate_existing_controls(rows: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    controls_by_user: dict[tuple[str, str], tuple[Any, ...]] = {}
    for row in rows:
        key = (row[1], row[2])
        existing = controls_by_user.get(key)
        preferred_id = _migration_id("control", row[1], row[2])
        preference = (row[0] == preferred_id, row[7], row[0])
        if existing is None:
            controls_by_user[key] = row
            continue
        existing_preference = (
            existing[0] == preferred_id,
            existing[7],
            existing[0],
        )
        if preference > existing_preference:
            controls_by_user[key] = row
    return sorted(controls_by_user.values(), key=lambda row: row[0])


def _reconcile_existing_control(
    row: tuple[Any, ...],
    *,
    identity_id_map: dict[str, str],
    conflicting_identity_ids: set[str],
) -> tuple[Any, ...]:
    remapped = _remap_existing_identity_id(
        row,
        identity_id_map=identity_id_map,
        identity_index=1,
    )
    if remapped[1] not in conflicting_identity_ids or remapped[3] != "active":
        return remapped
    return (*remapped[:3], "conflict", *remapped[4:])


def _remap_existing_identity_id(
    row: tuple[Any, ...],
    *,
    identity_id_map: dict[str, str],
    identity_index: int,
) -> tuple[Any, ...]:
    source_identity_id = row[identity_index]
    identity_id = identity_id_map.get(source_identity_id)
    if identity_id is None:
        msg = f"Existing ATProto graph row references unknown identity {source_identity_id}"
        raise RuntimeError(msg)
    values = list(row)
    values[identity_index] = identity_id
    return tuple(values)


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


def _legacy_control_rows(
    global_identity: _GlobalAtprotoIdentity,
    legacy_identities: list[_LegacyAtprotoIdentity],
) -> list[tuple[Any, ...]]:
    identities_by_user: dict[str, _LegacyAtprotoIdentity] = {}
    for identity in legacy_identities:
        identities_by_user.setdefault(identity.user_id, identity)
    control_status = "active" if len(identities_by_user) == 1 else "conflict"
    controls: list[tuple[Any, ...]] = []
    for user_id, source_identity in identities_by_user.items():
        control = (
            _migration_id("control", global_identity.id, user_id),
            global_identity.id,
            user_id,
            control_status,
            source_identity.handle_verified_at or source_identity.did_resolved_at,
            None,
            source_identity.created_at,
            source_identity.updated_at,
        )
        controls.append(control)
    return controls


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


async def _insert_unresolved_atproto_identity(
    conn: Any,
    legacy_link: _LegacyEntryAtprotoLink,
) -> _GlobalAtprotoIdentity:
    identity = _GlobalAtprotoIdentity(
        id=_migration_id("identity", legacy_link.did),
        did=legacy_link.did,
        current_handle=legacy_link.handle,
        pds_url=None,
        resolution_status="needs_attention",
        did_resolved_at=None,
        handle_verified_at=None,
        last_resolution_error=None,
        created_at=legacy_link.created_at,
        updated_at=legacy_link.updated_at,
    )
    await _insert_global_identity(conn, identity)
    return identity


def _profile_link_row(
    identity: _GlobalAtprotoIdentity,
    legacy_link: _LegacyEntryAtprotoLink,
    proof_links: dict[tuple[str, str, str], tuple[str, str]],
) -> tuple[Any, ...]:
    handle = _normalize_handle(legacy_link.handle)
    handle_matches = _normalize_handle(identity.current_handle) == handle
    status = (
        "verified"
        if identity.resolution_status == "verified" and handle_matches
        else "reverification_required"
    )
    claim_id, proof_id = proof_links.get(
        (legacy_link.entry_id, legacy_link.did, handle),
        (None, None),
    )
    return (
        _migration_id("profile-link", legacy_link.entry_id, identity.id),
        legacy_link.entry_id,
        identity.id,
        claim_id,
        proof_id,
        status,
        legacy_link.verified_at,
        legacy_link.verified_at,
        None,
        legacy_link.created_at,
        legacy_link.updated_at,
    )


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


async def _table_columns(conn: Any, table: str, *, backend: str) -> set[str]:
    if backend == "postgres":
        cursor = await conn.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = ?
            """,
            (table,),
        )
        return {str(row[0]) for row in await cursor.fetchall()}
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in await cursor.fetchall()}


async def _load_legacy_identities(conn: Any) -> list[_LegacyAtprotoIdentity]:
    cursor = await conn.execute(
        """
        SELECT id, user_id, did, current_handle, pds_url, did_resolved_at,
               handle_verified_at, created_at, updated_at
        FROM atproto_identities
        ORDER BY did, updated_at DESC, id DESC
        """
    )
    identities: list[_LegacyAtprotoIdentity] = []
    for row in await cursor.fetchall():
        if not all(_nonempty_text(row[index]) for index in (0, 1, 2, 3)):
            msg = "Legacy ATProto identity contains a missing identifier, user, DID, or handle"
            raise RuntimeError(msg)
        if row[5] is None or row[7] is None or row[8] is None:
            msg = f"Legacy ATProto identity {row[0]} contains missing audit timestamps"
            raise RuntimeError(msg)
        identities.append(
            _LegacyAtprotoIdentity(
                id=row[0],
                user_id=row[1],
                did=row[2],
                current_handle=row[3],
                pds_url=row[4],
                did_resolved_at=row[5],
                handle_verified_at=row[6],
                created_at=row[7],
                updated_at=row[8],
            )
        )
    return identities


async def _load_legacy_entry_links(
    conn: Any,
    *,
    entry_columns: set[str],
) -> list[_LegacyEntryAtprotoLink]:
    if not entry_columns:
        return []
    selected_columns = ["id"]
    selected_columns.extend(
        column if column in entry_columns else f"NULL AS {column}"
        for column in _LEGACY_ENTRY_ATPROTO_COLUMNS
    )
    selected_columns.extend(
        column if column in entry_columns else f"NULL AS {column}"
        for column in ("created_at", "updated_at")
    )
    cursor = await conn.execute(
        f"SELECT {', '.join(selected_columns)} FROM entries ORDER BY updated_at DESC, id DESC"
    )
    links: list[_LegacyEntryAtprotoLink] = []
    for row in await cursor.fetchall():
        entry_id, did, handle, verified_at, created_at, updated_at = row
        if did is None and handle is None and verified_at is None:
            continue
        if not _nonempty_text(entry_id) or not _nonempty_text(did) or not _nonempty_text(handle):
            msg = f"Corrupt legacy ATProto link for entry {entry_id}"
            raise RuntimeError(msg)
        if created_at is None or updated_at is None:
            msg = f"Legacy ATProto link for entry {entry_id} is missing audit timestamps"
            raise RuntimeError(msg)
        links.append(
            _LegacyEntryAtprotoLink(
                entry_id=entry_id,
                did=did,
                handle=handle,
                verified_at=verified_at,
                created_at=created_at,
                updated_at=updated_at,
            )
        )
    return links


async def _load_matching_atproto_proofs(
    conn: Any,
    *,
    claim_columns: set[str],
    proof_columns: set[str],
) -> dict[tuple[str, str, str], tuple[str, str]]:
    if not claim_columns or not proof_columns:
        return {}
    cursor = await conn.execute(
        """
        SELECT claims.entry_id, claims.id, proofs.id, proofs.proof_metadata_json
        FROM profile_claims AS claims
        JOIN profile_claim_proofs AS proofs ON proofs.claim_id = claims.id
        WHERE claims.status = 'verified'
          AND proofs.proof_type = 'atproto'
          AND proofs.proof_status = 'verified'
        ORDER BY claims.entry_id,
                 COALESCE(proofs.reviewed_at, proofs.created_at) DESC,
                 proofs.id DESC
        """
    )
    matches: dict[tuple[str, str, str], tuple[str, str]] = {}
    for entry_id, claim_id, proof_id, metadata_json in await cursor.fetchall():
        if not isinstance(metadata_json, str):
            continue
        try:
            metadata = json.loads(metadata_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(metadata, dict):
            continue
        did = metadata.get("did")
        handle = metadata.get("handle")
        if (
            not isinstance(did, str)
            or not did.strip()
            or not isinstance(handle, str)
            or not handle.strip()
        ):
            continue
        matches.setdefault(
            (entry_id, did, _normalize_handle(handle)),
            (claim_id, proof_id),
        )
    return matches


async def _lock_atproto_migration_sources(
    conn: Any,
    *,
    backend: str,
    tables: tuple[str, ...],
) -> None:
    if backend != "postgres":
        return
    await conn.execute(f"LOCK TABLE {', '.join(tables)} IN ACCESS EXCLUSIVE MODE")


async def _create_atproto_identity_graph(conn: Any, *, backend: str) -> None:
    ddl = _ATPROTO_GRAPH_POSTGRES_DDL if backend == "postgres" else _ATPROTO_GRAPH_SQLITE_DDL
    for statement in (*ddl, *_ATPROTO_GRAPH_INDEX_DDL):
        await conn.execute(statement)


async def _insert_global_identity(
    conn: Any,
    identity: _GlobalAtprotoIdentity,
) -> None:
    await conn.execute(
        """
        INSERT INTO atproto_identities (
            id, did, current_handle, pds_url, resolution_status,
            did_resolved_at, handle_verified_at, last_resolution_error,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (
            identity.id,
            identity.did,
            identity.current_handle,
            identity.pds_url,
            identity.resolution_status,
            identity.did_resolved_at,
            identity.handle_verified_at,
            identity.last_resolution_error,
            identity.created_at,
            identity.updated_at,
        ),
    )


async def _load_global_identities(conn: Any) -> dict[str, _GlobalAtprotoIdentity]:
    cursor = await conn.execute(
        """
        SELECT id, did, current_handle, pds_url, resolution_status, did_resolved_at,
               handle_verified_at, last_resolution_error, created_at, updated_at
        FROM atproto_identities
        """
    )
    return {
        row[1]: _GlobalAtprotoIdentity(
            id=row[0],
            did=row[1],
            current_handle=row[2],
            pds_url=row[3],
            resolution_status=row[4],
            did_resolved_at=row[5],
            handle_verified_at=row[6],
            last_resolution_error=row[7],
            created_at=row[8],
            updated_at=row[9],
        )
        for row in await cursor.fetchall()
    }


async def _assert_atproto_migration(
    conn: Any,
    expected: _AtprotoMigrationExpectations,
) -> None:
    actual_counts = (
        await _table_count(conn, "atproto_identities"),
        await _table_count(conn, "user_atproto_controls"),
        await _table_count(conn, "profile_atproto_links"),
    )
    expected_counts = (expected.identity_count, expected.control_count, expected.link_count)
    if actual_counts != expected_counts:
        msg = (
            "ATProto identity migration row-count mismatch: "
            f"expected {expected_counts}, found {actual_counts}"
        )
        raise RuntimeError(msg)

    for did, identity in expected.identities.items():
        cursor = await conn.execute(
            """
            SELECT id, did, current_handle, pds_url, resolution_status,
                   did_resolved_at, handle_verified_at, last_resolution_error,
                   created_at, updated_at
            FROM atproto_identities
            WHERE did = ?
            """,
            (did,),
        )
        row = await cursor.fetchone()
        expected_identity = (
            identity.id,
            identity.did,
            identity.current_handle,
            identity.pds_url,
            identity.resolution_status,
            identity.did_resolved_at,
            identity.handle_verified_at,
            identity.last_resolution_error,
            identity.created_at,
            identity.updated_at,
        )
        if row != expected_identity:
            msg = f"ATProto identity migration data mismatch for DID {did}"
            raise RuntimeError(msg)

    for control in expected.controls:
        cursor = await conn.execute(
            """
            SELECT id, identity_id, user_id, status, verified_at,
                   disconnected_at, created_at, updated_at
            FROM user_atproto_controls
            WHERE id = ?
            """,
            (control[0],),
        )
        if await cursor.fetchone() != control:
            msg = f"ATProto control migration data mismatch for user {control[2]}"
            raise RuntimeError(msg)

    for link in expected.links:
        cursor = await conn.execute(
            """
            SELECT id, entry_id, identity_id, claim_id, proof_id, status,
                   verified_at, last_checked_at, removed_at, created_at, updated_at
            FROM profile_atproto_links
            WHERE id = ?
            """,
            (link[0],),
        )
        if await cursor.fetchone() != link:
            msg = f"ATProto profile-link migration data mismatch for entry {link[1]}"
            raise RuntimeError(msg)


async def _table_count(conn: Any, table: str) -> int:
    cursor = await conn.execute(f"SELECT COUNT(*) FROM {table}")
    row = await cursor.fetchone()
    if row is None:
        msg = f"Could not count migration table {table}"
        raise RuntimeError(msg)
    return int(row[0])


def _migration_id(kind: str, *parts: str) -> str:
    name = json.dumps((kind, *parts), separators=(",", ":"))
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"atlas:atproto-identity-graph:{name}"))


def _nonempty_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _normalize_handle(handle: str) -> str:
    return handle.strip().removeprefix("@").casefold()


async def _ensure_entry_columns(conn: Any) -> None:
    """Apply additive entry-table migrations for local SQLite databases.

    Safe to call before the full schema script — returns early if the
    entries table doesn't exist yet (fresh database).
    """
    cursor = await conn.execute("PRAGMA table_info(entries)")
    rows = await cursor.fetchall()
    if not rows:
        return  # Table doesn't exist yet; full schema will create it with all columns.
    existing_columns = {row[1] for row in rows}

    additive_columns = (
        ("full_address", "ALTER TABLE entries ADD COLUMN full_address TEXT"),
        ("slug", "ALTER TABLE entries ADD COLUMN slug TEXT"),
        ("photo_url", "ALTER TABLE entries ADD COLUMN photo_url TEXT"),
        ("custom_bio", "ALTER TABLE entries ADD COLUMN custom_bio TEXT"),
        (
            "claim_status",
            "ALTER TABLE entries ADD COLUMN claim_status TEXT NOT NULL DEFAULT 'unclaimed'",
        ),
        ("claimed_by_user_id", "ALTER TABLE entries ADD COLUMN claimed_by_user_id TEXT"),
        ("claim_verified_at", "ALTER TABLE entries ADD COLUMN claim_verified_at DATETIME"),
        ("last_confirmed_at", "ALTER TABLE entries ADD COLUMN last_confirmed_at DATETIME"),
        ("suppressed_source_ids", "ALTER TABLE entries ADD COLUMN suppressed_source_ids TEXT"),
        (
            "preferred_contact_channel",
            "ALTER TABLE entries ADD COLUMN preferred_contact_channel TEXT",
        ),
        ("latitude", "ALTER TABLE entries ADD COLUMN latitude REAL"),
        ("longitude", "ALTER TABLE entries ADD COLUMN longitude REAL"),
        ("geocode_precision", "ALTER TABLE entries ADD COLUMN geocode_precision TEXT"),
        ("geocode_source", "ALTER TABLE entries ADD COLUMN geocode_source TEXT"),
    )
    # Indexes that must follow their backing column when it is freshly added.
    follow_up_indexes = {
        "slug": "CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug)",
        "geocode_source": (
            "CREATE INDEX IF NOT EXISTS idx_entries_lat_lng ON entries(latitude, longitude)"
        ),
    }

    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)
            index_ddl = follow_up_indexes.get(column)
            if index_ddl is not None:
                await conn.execute(index_ddl)


async def _ensure_discovery_run_columns(conn: Any) -> None:
    """Apply additive discovery-run migrations for stored research outputs."""
    cursor = await conn.execute("PRAGMA table_info(discovery_runs)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    if "research_goal" not in existing_columns:
        await conn.execute(
            """
            ALTER TABLE discovery_runs
            ADD COLUMN research_goal TEXT NOT NULL DEFAULT 'landscape_scan'
            """
        )
    if "research_summary" not in existing_columns:
        await conn.execute("ALTER TABLE discovery_runs ADD COLUMN research_summary TEXT")


async def _ensure_discovery_job_columns(conn: Any) -> None:
    """Apply additive discovery-job migrations before index creation."""
    cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    additive_columns = (
        ("idempotency_key", "ALTER TABLE discovery_jobs ADD COLUMN idempotency_key TEXT"),
        ("next_attempt_at", "ALTER TABLE discovery_jobs ADD COLUMN next_attempt_at DATETIME"),
        (
            "execution_mode",
            "ALTER TABLE discovery_jobs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'search'",
        ),
        (
            "input_payload",
            "ALTER TABLE discovery_jobs ADD COLUMN input_payload TEXT NOT NULL DEFAULT '{}'",
        ),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)


async def _ensure_review_queue_columns(conn: Any) -> None:
    """Apply additive review-queue migrations for tenant moderation boundaries."""
    cursor = await conn.execute("PRAGMA table_info(review_queue)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    if "org_id" not in existing_columns:
        await conn.execute("ALTER TABLE review_queue ADD COLUMN org_id TEXT")

    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_queue_org_status ON review_queue(org_id, status)"
    )


async def _ensure_org_annotation_columns(conn: Any) -> None:
    """Apply SQLite migrations for typed private notes on entries and sources."""
    cursor = await conn.execute("PRAGMA table_info(org_annotations)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    entry_column = next((row for row in rows if row[1] == "entry_id"), None)
    entry_is_not_null = bool(entry_column and entry_column[3])

    if entry_is_not_null:
        await conn.execute("ALTER TABLE org_annotations RENAME TO org_annotations_legacy")
        await conn.execute(
            """
            CREATE TABLE org_annotations (
                id TEXT PRIMARY KEY,
                org_id TEXT NOT NULL,
                entry_id TEXT,
                source_id TEXT,
                target_type TEXT NOT NULL DEFAULT 'entry'
                    CHECK(target_type IN ('entry', 'source')),
                target_id TEXT,
                content TEXT NOT NULL,
                author_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                FOREIGN KEY (entry_id) REFERENCES entries(id),
                FOREIGN KEY (source_id) REFERENCES sources(id)
            )
            """
        )
        await conn.execute(
            """
            INSERT INTO org_annotations (
                id, org_id, entry_id, source_id, target_type, target_id,
                content, author_id, created_at, updated_at
            )
            SELECT
                id, org_id, entry_id, NULL, 'entry', entry_id,
                content, author_id, created_at, updated_at
            FROM org_annotations_legacy
            """
        )
        await conn.execute("DROP TABLE org_annotations_legacy")
        existing_columns = {
            "id",
            "org_id",
            "entry_id",
            "source_id",
            "target_type",
            "target_id",
            "content",
            "author_id",
            "created_at",
            "updated_at",
        }

    additive_columns = (
        ("source_id", "ALTER TABLE org_annotations ADD COLUMN source_id TEXT"),
        (
            "target_type",
            "ALTER TABLE org_annotations ADD COLUMN target_type TEXT NOT NULL DEFAULT 'entry'",
        ),
        ("target_id", "ALTER TABLE org_annotations ADD COLUMN target_id TEXT"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)

    await conn.execute("UPDATE org_annotations SET target_type = 'entry' WHERE target_type IS NULL")
    await conn.execute(
        "UPDATE org_annotations SET target_id = entry_id "
        "WHERE target_id IS NULL AND entry_id IS NOT NULL"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_annotations_source ON org_annotations(source_id)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_org_annotations_target "
        "ON org_annotations(target_type, target_id)"
    )


async def _ensure_place_related_place_columns(conn: Any) -> None:
    """Apply additive place-related-place migrations for local SQLite databases."""
    cursor = await conn.execute("PRAGMA table_info(place_related_places)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    additive_columns = (
        ("latitude", "ALTER TABLE place_related_places ADD COLUMN latitude REAL"),
        ("longitude", "ALTER TABLE place_related_places ADD COLUMN longitude REAL"),
        ("source_dataset", "ALTER TABLE place_related_places ADD COLUMN source_dataset TEXT"),
        ("source_identifier", "ALTER TABLE place_related_places ADD COLUMN source_identifier TEXT"),
        ("source_url", "ALTER TABLE place_related_places ADD COLUMN source_url TEXT"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)


async def _ensure_place_context_columns(conn: Any) -> None:
    """Apply additive place-context migrations for local SQLite databases."""
    cursor = await conn.execute("PRAGMA table_info(place_contexts)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    additive_columns = (
        ("source_dataset", "ALTER TABLE place_contexts ADD COLUMN source_dataset TEXT"),
        ("source_identifier", "ALTER TABLE place_contexts ADD COLUMN source_identifier TEXT"),
        ("source_url", "ALTER TABLE place_contexts ADD COLUMN source_url TEXT"),
    )
    for column, ddl in additive_columns:
        if column not in existing_columns:
            await conn.execute(ddl)


async def _ensure_org_coverage_target_columns(conn: Any) -> None:
    """Apply additive coverage-target migrations for customer delivery review state."""
    cursor = await conn.execute("PRAGMA table_info(org_coverage_targets)")
    rows = await cursor.fetchall()
    if not rows:
        return

    existing_columns = {row[1] for row in rows}
    if "review_state" not in existing_columns:
        await conn.execute(
            """
            ALTER TABLE org_coverage_targets
            ADD COLUMN review_state TEXT NOT NULL DEFAULT 'needs_research'
            """
        )
