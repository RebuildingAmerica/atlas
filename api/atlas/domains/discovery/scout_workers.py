"""Scout workers their owners revoked, and the check every job lease runs."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, status

from atlas.platform.database import db as db_manager

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

NEEDS_WORKER_DETAIL = "Claiming Scout jobs needs a Scout worker sign-in."
OTHER_WORKER_DETAIL = "This Scout sign-in belongs to a different worker."
REVOKED_WORKER_DETAIL = "This Scout worker was revoked."


class ScoutWorkerRevocationCRUD:
    """Record and look up workers their owner revoked."""

    @staticmethod
    async def revoke(conn: aiosqlite.Connection, *, worker_id: str, user_id: str) -> None:
        """Record that ``user_id`` revoked their worker ``worker_id``.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        worker_id : str
            The enrolled worker's id.
        user_id : str
            The worker's owner, who revoked it.
        """
        cursor = await conn.execute(
            "SELECT 1 FROM scout_worker_revocations WHERE worker_id = ? AND user_id = ?",
            (worker_id, user_id),
        )
        if await cursor.fetchone() is not None:
            return
        await conn.execute(
            "INSERT INTO scout_worker_revocations (worker_id, user_id, revoked_at) VALUES (?, ?, ?)",
            (worker_id, user_id, db_manager.now_iso()),
        )
        await conn.commit()

    @staticmethod
    async def is_revoked(conn: aiosqlite.Connection, *, worker_id: str, user_id: str) -> bool:
        """Return whether ``user_id`` revoked their worker ``worker_id``.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        worker_id : str
            The enrolled worker's id.
        user_id : str
            The signed-in owner the worker's token names.

        Returns
        -------
        bool
            ``True`` once the owner revoked the worker.
        """
        cursor = await conn.execute(
            "SELECT 1 FROM scout_worker_revocations WHERE worker_id = ? AND user_id = ?",
            (worker_id, user_id),
        )
        return await cursor.fetchone() is not None


async def require_bound_worker(
    conn: aiosqlite.Connection,
    actor: AuthenticatedActor,
    worker_id: str,
) -> None:
    """Refuse a job lease unless the caller is that enrolled, unrevoked worker.

    A Scout worker's sign-in carries the id of the worker device its owner
    enrolled. Only that worker may claim, renew, complete or fail leases under
    that id, so another account's token cannot take over a volunteer's queue,
    and revoking the device ends its leases at once.

    Parameters
    ----------
    conn : aiosqlite.Connection
        Database connection.
    actor : AuthenticatedActor
        The authenticated caller.
    worker_id : str
        The worker id the request names.

    Raises
    ------
    HTTPException
        403 when the caller is not a Scout worker sign-in, belongs to another
        worker, or its worker was revoked.
    """
    if actor.is_local:
        return
    if actor.worker_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NEEDS_WORKER_DETAIL)
    if actor.worker_id != worker_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=OTHER_WORKER_DETAIL)
    if await ScoutWorkerRevocationCRUD.is_revoked(conn, worker_id=worker_id, user_id=actor.user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REVOKED_WORKER_DETAIL)
