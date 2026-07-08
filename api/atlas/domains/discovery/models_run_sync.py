"""Discovery run sync records."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db


@dataclass
class DiscoveryRunSyncModel:
    """Idempotent sync record linking a local runner bundle to an Atlas run."""

    id: str
    local_run_id: str
    artifact_hash: str
    remote_run_id: str
    actor_user_id: str
    actor_email: str | None
    sync_status: str
    created_at: str
    synced_at: str | None


class DiscoveryRunSyncCRUD:
    """CRUD helpers for discovery bundle sync records."""

    @staticmethod
    async def get_by_identity(
        conn: aiosqlite.Connection,
        *,
        local_run_id: str,
        artifact_hash: str,
    ) -> DiscoveryRunSyncModel | None:
        """Return an existing sync row for a local bundle identity, if present."""
        cursor = await conn.execute(
            """
            SELECT *
            FROM discovery_run_syncs
            WHERE local_run_id = ? AND artifact_hash = ?
            """,
            (local_run_id, artifact_hash),
        )
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_run_sync(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        local_run_id: str,
        artifact_hash: str,
        remote_run_id: str,
        actor_user_id: str,
        actor_email: str | None,
        sync_status: str,
    ) -> str:
        """Create a durable sync record for a successfully replayed bundle."""
        sync_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO discovery_run_syncs (
                id,
                local_run_id,
                artifact_hash,
                remote_run_id,
                actor_user_id,
                actor_email,
                sync_status,
                created_at,
                synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sync_id,
                local_run_id,
                artifact_hash,
                remote_run_id,
                actor_user_id,
                actor_email,
                sync_status,
                now,
                now,
            ),
        )
        await conn.commit()
        return sync_id


def _row_to_discovery_run_sync(row: dict[str, Any]) -> DiscoveryRunSyncModel:
    """Convert database row to DiscoveryRunSyncModel."""
    return DiscoveryRunSyncModel(
        id=row["id"],
        local_run_id=row["local_run_id"],
        artifact_hash=row["artifact_hash"],
        remote_run_id=row["remote_run_id"],
        actor_user_id=row["actor_user_id"],
        actor_email=row["actor_email"],
        sync_status=row["sync_status"],
        created_at=row["created_at"],
        synced_at=row["synced_at"],
    )
