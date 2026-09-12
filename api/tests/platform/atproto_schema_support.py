"""Column sets and PostgreSQL fixtures the identity-graph tests share.

_prepare_legacy_postgres_database builds the pre-migration shape by hand,
because the point of these tests is what happens to a database that was
created before the identity graph existed.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import psycopg
import pytest

from atlas.models import init_db
from atlas.models.database import PostgresConnection
from atlas.models.database_migrations import (
    _ATPROTO_GRAPH_POSTGRES_DDL,
    _migration_id,
)

if TYPE_CHECKING:
    from typing import Any

    import aiosqlite


IDENTITY_COLUMNS = {
    "id",
    "did",
    "current_handle",
    "pds_url",
    "resolution_status",
    "did_resolved_at",
    "handle_verified_at",
    "last_resolution_error",
    "created_at",
    "updated_at",
}


CONTROL_COLUMNS = {
    "id",
    "identity_id",
    "user_id",
    "status",
    "verified_at",
    "disconnected_at",
    "created_at",
    "updated_at",
}


PROFILE_LINK_COLUMNS = {
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
}


LEGACY_ENTRY_COLUMNS = {
    "linked_atproto_did",
    "linked_atproto_handle",
    "linked_atproto_verified_at",
}


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in await cursor.fetchall()}


async def _postgres_columns(conn: PostgresConnection, table: str) -> set[str]:
    cursor = await conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ?
        """,
        (table,),
    )
    return {str(row[0]) for row in await cursor.fetchall()}


async def _insert_postgres_identity(
    conn: PostgresConnection,
    identity_id: str,
    did: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO atproto_identities (
            id, did, current_handle, resolution_status, created_at, updated_at
        ) VALUES (?, ?, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        (identity_id, did, f"{identity_id}.example"),
    )


async def _insert_postgres_control(
    conn: PostgresConnection,
    control_id: str,
    identity_id: str,
    user_id: str,
    status: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO user_atproto_controls (
            id, identity_id, user_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        (control_id, identity_id, user_id, status),
    )


async def _insert_postgres_link(
    conn: PostgresConnection,
    link_id: str,
    identity_id: str,
    status: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO profile_atproto_links (
            id, entry_id, identity_id, status, created_at, updated_at
        ) VALUES (?, 'entry-one', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        (link_id, identity_id, status),
    )


async def _prepare_legacy_postgres_database(
    database_url: str,
    *,
    handle: str | None = "postgres.example",
    partial_controller_user_id: str | None = None,
    with_verified_proof: bool = False,
) -> None:
    await init_db(database_url)
    raw_conn = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        for statement in (
            "DROP TABLE profile_atproto_links",
            "DROP TABLE user_atproto_controls",
            "DROP TABLE atproto_identity_delegations",
            "DROP TABLE organization_atproto_identities",
            "DROP TABLE atproto_identities",
            "ALTER TABLE entries ADD COLUMN linked_atproto_did TEXT",
            "ALTER TABLE entries ADD COLUMN linked_atproto_handle TEXT",
            "ALTER TABLE entries ADD COLUMN linked_atproto_verified_at TIMESTAMPTZ",
            """
            CREATE TABLE atproto_identities (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                did TEXT NOT NULL,
                current_handle TEXT NOT NULL,
                pds_url TEXT,
                did_resolved_at TIMESTAMPTZ NOT NULL,
                handle_verified_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                UNIQUE(user_id, did)
            )
            """,
            "CREATE INDEX idx_atproto_identities_user ON atproto_identities(user_id)",
            "CREATE INDEX idx_atproto_identities_did ON atproto_identities(did)",
        ):
            await conn.execute(statement)
        await conn.execute(
            """
            INSERT INTO atproto_identities (
                id, user_id, did, current_handle, pds_url, did_resolved_at,
                handle_verified_at, created_at, updated_at
            ) VALUES (
                'identity-postgres', 'user-postgres', 'did:plc:postgres',
                'postgres.example', 'https://pds.example',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """
        )
        await conn.execute(
            """
            INSERT INTO entries (
                id, type, name, description, geo_specificity,
                linked_atproto_did, linked_atproto_handle, linked_atproto_verified_at,
                first_seen, last_seen, created_at, updated_at
            ) VALUES (
                'entry-postgres', 'person', 'Postgres', 'Postgres', 'local',
                'did:plc:postgres', ?, CURRENT_TIMESTAMP,
                CURRENT_DATE, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """,
            (handle,),
        )
        if partial_controller_user_id is not None:
            for statement in _ATPROTO_GRAPH_POSTGRES_DDL[1:]:
                await conn.execute(statement)
            control_id = _migration_id(
                "control",
                "identity-postgres",
                partial_controller_user_id,
            )
            link_id = _migration_id(
                "profile-link",
                "entry-postgres",
                "identity-postgres",
            )
            await conn.execute(
                """
                INSERT INTO user_atproto_controls (
                    id, identity_id, user_id, status, verified_at, created_at, updated_at
                ) VALUES (
                    ?, 'identity-postgres', ?, 'active',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                (control_id, partial_controller_user_id),
            )
            await conn.execute(
                """
                INSERT INTO profile_atproto_links (
                    id, entry_id, identity_id, status, verified_at,
                    last_checked_at, created_at, updated_at
                ) VALUES (
                    ?, 'entry-postgres', 'identity-postgres', 'verified',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                (link_id,),
            )
        if with_verified_proof:
            await conn.execute(
                """
                INSERT INTO profile_claims (
                    id, entry_id, user_id, user_email, status, tier,
                    verified_at, created_at, updated_at
                ) VALUES (
                    'claim-postgres', 'entry-postgres', 'user-postgres',
                    'postgres@example.com', 'verified', 1,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            )
            await conn.execute(
                """
                INSERT INTO profile_claim_proofs (
                    id, claim_id, proof_type, proof_status, proof_summary,
                    proof_metadata_json, created_at, reviewed_at
                ) VALUES (
                    'proof-postgres', 'claim-postgres', 'atproto', 'verified',
                    'ATProto evidence.',
                    '{"did":"did:plc:postgres","handle":"postgres.example"}',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            )
    finally:
        await raw_conn.close()


async def _wait_for_postgres_lock_waiters(conn: Any, *, expected: int) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 5
    while loop.time() < deadline:
        cursor = await conn.execute(
            """
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
            """
        )
        row = await cursor.fetchone()
        if row is not None and int(row[0]) >= expected:
            return
        await asyncio.sleep(0.01)
    cursor = await conn.execute(
        """
        SELECT state, wait_event_type, wait_event, query
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        ORDER BY pid
        """
    )
    pytest.fail(f"PostgreSQL activity: {await cursor.fetchall()!r}")


class _PausingPostgresConnection:
    backend = "postgres"

    def __init__(
        self,
        inner: PostgresConnection,
        *,
        source_read_reached: asyncio.Event,
        resume_source_read: asyncio.Event,
    ) -> None:
        self._inner = inner
        self._source_read_reached = source_read_reached
        self._resume_source_read = resume_source_read

    async def execute(
        self,
        statement: str,
        parameters: tuple[Any, ...] = (),
    ) -> Any:
        if "FROM entries ORDER BY updated_at DESC, id DESC" in " ".join(statement.split()):
            self._source_read_reached.set()
            await self._resume_source_read.wait()
        return await self._inner.execute(statement, parameters)
