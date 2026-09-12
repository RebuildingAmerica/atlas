"""Shared fixtures for the database schema migration tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import aiosqlite

from atlas.models.database import (
    init_db,
)
from atlas.models.database_migrations import (
    _ATPROTO_GRAPH_SQLITE_DDL,
    _migration_id,
)

if TYPE_CHECKING:
    import asyncio
    from pathlib import Path

TIMESTAMP = "2026-07-12T12:00:00+00:00"
LEGACY_ATPROTO_COLUMNS = {
    "linked_atproto_did",
    "linked_atproto_handle",
    "linked_atproto_verified_at",
}


async def _reset_to_legacy_atproto_schema(conn: aiosqlite.Connection) -> None:
    """Replace only the fresh ATProto graph with the pre-migration shape."""
    await conn.executescript(
        """
        DROP TABLE IF EXISTS profile_atproto_links;
        DROP TABLE IF EXISTS user_atproto_controls;
        DROP TABLE IF EXISTS atproto_identities;
        """
    )
    cursor = await conn.execute("PRAGMA table_info(entries)")
    entry_columns = {str(row[1]) for row in await cursor.fetchall()}
    for column in sorted(LEGACY_ATPROTO_COLUMNS - entry_columns):
        await conn.execute(f"ALTER TABLE entries ADD COLUMN {column} TEXT")
    await conn.executescript(
        """
        CREATE TABLE atproto_identities (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            did TEXT NOT NULL,
            current_handle TEXT NOT NULL,
            pds_url TEXT,
            did_resolved_at TEXT NOT NULL,
            handle_verified_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, did)
        );
        CREATE INDEX idx_atproto_identities_user ON atproto_identities(user_id);
        CREATE INDEX idx_atproto_identities_did ON atproto_identities(did);
        """
    )


async def _insert_legacy_entry(
    conn: aiosqlite.Connection,
    entry_id: str,
    *,
    did: str | None,
    handle: str | None,
    verified_at: str | None,
) -> None:
    await conn.execute(
        """
        INSERT INTO entries (
            id, type, name, description, geo_specificity,
            linked_atproto_did, linked_atproto_handle, linked_atproto_verified_at,
            first_seen, last_seen, created_at, updated_at
        ) VALUES (?, 'person', ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entry_id,
            entry_id,
            entry_id,
            did,
            handle,
            verified_at,
            TIMESTAMP,
            TIMESTAMP,
            TIMESTAMP,
            TIMESTAMP,
        ),
    )


async def _insert_legacy_identity_link(
    conn: aiosqlite.Connection,
    *,
    key: str,
    did: str,
    handle: str,
    pds_url: str | None = None,
) -> tuple[str, str, str]:
    identity_id = f"identity-{key}"
    user_id = f"user-{key}"
    entry_id = f"entry-{key}"
    await conn.execute(
        """
        INSERT INTO atproto_identities (
            id, user_id, did, current_handle, pds_url, did_resolved_at,
            handle_verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (identity_id, user_id, did, handle, pds_url, TIMESTAMP, TIMESTAMP, TIMESTAMP, TIMESTAMP),
    )
    await _insert_legacy_entry(
        conn,
        entry_id,
        did=did,
        handle=handle,
        verified_at=TIMESTAMP,
    )
    return identity_id, user_id, entry_id


async def _legacy_database(database_path: Path) -> aiosqlite.Connection:
    await init_db(f"sqlite:///{database_path}")
    conn = await aiosqlite.connect(database_path)
    await _reset_to_legacy_atproto_schema(conn)
    return conn


async def _create_partial_atproto_graph(conn: aiosqlite.Connection) -> None:
    for statement in _ATPROTO_GRAPH_SQLITE_DDL[1:]:
        await conn.execute(statement)


async def _insert_partial_atproto_control(
    conn: aiosqlite.Connection,
    *,
    identity_id: str,
    user_id: str,
    status: str = "active",
) -> str:
    control_id = _migration_id("control", identity_id, user_id)
    await conn.execute(
        """
        INSERT INTO user_atproto_controls (
            id, identity_id, user_id, status, verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (control_id, identity_id, user_id, status, TIMESTAMP, TIMESTAMP, TIMESTAMP),
    )
    return control_id


async def _insert_partial_atproto_link(
    conn: aiosqlite.Connection,
    *,
    identity_id: str,
    entry_id: str,
) -> str:
    link_id = _migration_id("profile-link", entry_id, identity_id)
    await conn.execute(
        """
        INSERT INTO profile_atproto_links (
            id, entry_id, identity_id, status, verified_at,
            last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'verified', ?, ?, ?, ?)
        """,
        (link_id, entry_id, identity_id, TIMESTAMP, TIMESTAMP, TIMESTAMP, TIMESTAMP),
    )
    return link_id


async def _insert_atproto_claim_proof(
    conn: aiosqlite.Connection,
    *,
    suffix: str,
    entry_id: str,
    statuses: tuple[str, str],
    reviewed_at: str,
) -> tuple[str, str]:
    claim_status, proof_status = statuses
    claim_id = f"claim-{suffix}"
    proof_id = f"proof-{suffix}"
    await conn.execute(
        """
        INSERT INTO profile_claims (
            id, entry_id, user_id, user_email, status, tier,
            verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        """,
        (
            claim_id,
            entry_id,
            f"user-{suffix}",
            f"{suffix}@example.com",
            claim_status,
            reviewed_at if claim_status == "verified" else None,
            reviewed_at,
            reviewed_at,
        ),
    )
    await conn.execute(
        """
        INSERT INTO profile_claim_proofs (
            id, claim_id, proof_type, proof_status, proof_summary,
            proof_metadata_json, created_at, reviewed_at
        ) VALUES (?, ?, 'atproto', ?, ?, ?, ?, ?)
        """,
        (
            proof_id,
            claim_id,
            proof_status,
            "ATProto evidence.",
            json.dumps({"did": "did:plc:proof", "handle": "proof.example"}),
            reviewed_at,
            reviewed_at,
        ),
    )
    return claim_id, proof_id


class _PausingSqliteConnection:
    def __init__(
        self,
        inner: aiosqlite.Connection,
        *,
        source_read_reached: asyncio.Event,
        resume_source_read: asyncio.Event,
    ) -> None:
        self._inner = inner
        self._source_read_reached = source_read_reached
        self._resume_source_read = resume_source_read

    @property
    def in_transaction(self) -> bool:
        return self._inner.in_transaction

    async def execute(
        self,
        statement: str,
        parameters: tuple[object, ...] = (),
    ) -> object:
        if "FROM entries ORDER BY updated_at DESC, id DESC" in " ".join(statement.split()):
            self._source_read_reached.set()
            await self._resume_source_read.wait()
        return await self._inner.execute(statement, parameters)

    async def commit(self) -> None:
        await self._inner.commit()

    async def rollback(self) -> None:
        await self._inner.rollback()
