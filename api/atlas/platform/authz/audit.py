"""The append-only record of operator decisions that change data."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

    from .actions import Action

Plane = Literal["customer", "staff", "machine", "local"]

_COLUMNS = (
    "id, occurred_at, plane, actor_id, actor_email, auth_type, action, allowed, "
    "status_code, method, route, target_json, reason, request_id"
)


def actor_plane(actor: AuthenticatedActor) -> Plane:
    """Return which sign-in plane an authenticated caller arrived through.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.

    Returns
    -------
    Plane
        ``local`` for single-user mode; ``customer`` for anyone signed in to the
        Atlas app, an API key or an OAuth token.
    """
    if actor.is_local:
        return "local"
    return "customer"


@dataclass(frozen=True, slots=True)
class AuditRecord:
    """One decision to append to the audit log."""

    plane: Plane
    actor_id: str
    actor_email: str | None
    auth_type: str
    action: Action
    allowed: bool
    status_code: int
    method: str
    route: str
    target: dict[str, str] = field(default_factory=dict)
    reason: str | None = None
    request_id: str | None = None


@dataclass(frozen=True, slots=True)
class AuditEntry:
    """One decision as stored in the audit log."""

    id: str
    occurred_at: str
    plane: str
    actor_id: str
    actor_email: str | None
    auth_type: str
    action: str
    allowed: bool
    status_code: int
    method: str
    route: str
    target: dict[str, str]
    reason: str | None
    request_id: str | None


def _row_to_entry(row: Any) -> AuditEntry:
    """Convert a database row into an :class:`AuditEntry`."""
    return AuditEntry(
        id=str(row[0]),
        occurred_at=str(row[1]),
        plane=str(row[2]),
        actor_id=str(row[3]),
        actor_email=str(row[4]) if row[4] is not None else None,
        auth_type=str(row[5]),
        action=str(row[6]),
        allowed=bool(row[7]),
        status_code=int(row[8]),
        method=str(row[9]),
        route=str(row[10]),
        target=json.loads(str(row[11])),
        reason=str(row[12]) if row[12] is not None else None,
        request_id=str(row[13]) if row[13] is not None else None,
    )


class AuditLogCRUD:
    """Append to and read the audit log. There is deliberately no update or delete."""

    @staticmethod
    async def record(conn: aiosqlite.Connection, record: AuditRecord) -> str:
        """Append one decision and commit it.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        record : AuditRecord
            The decision to append.

        Returns
        -------
        str
            The new entry's id.
        """
        entry_id = db.generate_uuid()
        await conn.execute(
            f"INSERT INTO audit_log ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entry_id,
                db.now_iso(),
                record.plane,
                record.actor_id,
                record.actor_email,
                record.auth_type,
                record.action.value,
                record.allowed,
                int(record.status_code),
                record.method,
                record.route,
                json.dumps(record.target, sort_keys=True),
                record.reason,
                record.request_id,
            ),
        )
        await conn.commit()
        return entry_id

    @staticmethod
    async def list_recent(
        conn: aiosqlite.Connection,
        *,
        limit: int,
        action: Action | None = None,
    ) -> list[AuditEntry]:
        """Return the most recent decisions, newest first.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        limit : int
            Maximum number of entries to return.
        action : Action | None
            Only return decisions about this action, when given.

        Returns
        -------
        list[AuditEntry]
            Entries ordered from newest to oldest.
        """
        where = "WHERE action = ?" if action is not None else ""
        params: tuple[object, ...] = (action.value, limit) if action is not None else (limit,)
        cursor = await conn.execute(
            f"SELECT {_COLUMNS} FROM audit_log {where} ORDER BY occurred_at DESC LIMIT ?",
            params,
        )
        return [_row_to_entry(row) for row in await cursor.fetchall()]
