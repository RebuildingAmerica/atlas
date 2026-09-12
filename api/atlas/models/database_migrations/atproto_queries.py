"""Reads and writes the ATProto migration performs against one backend."""

from __future__ import annotations

import json
from typing import Any

from .atproto_ddl import (
    _ATPROTO_CONTROL_COLUMNS,
    _ATPROTO_GRAPH_INDEX_DDL,
    _ATPROTO_GRAPH_POSTGRES_DDL,
    _ATPROTO_GRAPH_SQLITE_DDL,
    _ATPROTO_PROFILE_LINK_COLUMNS,
)
from .atproto_reconcile import _migration_id, _nonempty_text, _normalize_handle
from .atproto_records import (
    _LEGACY_ENTRY_ATPROTO_COLUMNS,
    _ExistingAtprotoGraphRows,
    _GlobalAtprotoIdentity,
    _LegacyAtprotoIdentity,
    _LegacyEntryAtprotoLink,
)


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


async def _table_count(conn: Any, table: str) -> int:
    cursor = await conn.execute(f"SELECT COUNT(*) FROM {table}")
    row = await cursor.fetchone()
    if row is None:
        msg = f"Could not count migration table {table}"
        raise RuntimeError(msg)
    return int(row[0])
