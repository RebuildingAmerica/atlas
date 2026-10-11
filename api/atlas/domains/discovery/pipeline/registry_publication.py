"""Commit one resolved mention and its retry receipt without replaying review.

The transaction protects the facts and source trail visitors trust, as well as
curator decisions made after a successful invocation whose response was lost.
Existing Node publication helpers retain their ordinary commit behavior.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import suppress
from datetime import date
from typing import TYPE_CHECKING, Any, cast

from atlas_shared import PageContent
from pydantic import TypeAdapter

from atlas.domains.discovery.resolution.mentions import OrganizationMention, PersonMention
from atlas.domains.discovery.resolution.persist import (
    ResolutionSummary,
    _store_organization,
    _store_person,
)

from .web_checkpoints import CheckpointInputsChangedError, _Checkpoints

if TYPE_CHECKING:
    from collections.abc import Sequence

    from aiosqlite import Connection, Cursor

_MENTION_CODEC: TypeAdapter[OrganizationMention | PersonMention] = TypeAdapter(
    OrganizationMention | PersonMention
)
_MENTION_CODEC.rebuild(_types_namespace={"date": date, "PageContent": PageContent})
_SUMMARY_CODEC = TypeAdapter(ResolutionSummary)
_PREFIX = "publication:registry:"


class _UnitConnection:
    """Expose only helper reads/writes; the enclosing unit alone can commit."""

    def __init__(self, conn: Connection) -> None:
        self._conn = conn

    async def execute(self, sql: str, parameters: Sequence[Any] = ()) -> Cursor:
        if sql.lstrip().split(maxsplit=1)[0].upper() not in {
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
            "WITH",
        }:
            msg = "Publication helpers cannot control the enclosing transaction"
            raise ValueError(msg)
        return await self._conn.execute(sql, parameters)

    async def commit(self) -> None:
        """A helper's commit is deferred until its receipt is durable too."""


def _fingerprint(
    mention: OrganizationMention | PersonMention,
    issue_areas: Sequence[str],
    today: date,
    organization_unit_key: str | None,
) -> str:
    return hashlib.sha256(
        json.dumps(
            {
                "version": 1,
                "mention": _MENTION_CODEC.dump_python(mention, mode="json"),
                "issues": list(issue_areas),
                "today": today.isoformat(),
                "organization_unit": organization_unit_key,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


async def _receipt(
    conn: Connection, job_id: str, key: str, fingerprint: str
) -> ResolutionSummary | None:
    cursor = await conn.execute(
        "SELECT fingerprint, result FROM discovery_web_checkpoints WHERE job_id = ? AND unit_key = ?",
        (job_id, _PREFIX + key),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    if row[0] != fingerprint:
        raise CheckpointInputsChangedError
    return _SUMMARY_CODEC.validate_json(row[1])


async def publish_registry_mention(  # noqa: PLR0913
    conn: Connection,
    *,
    job_id: str,
    claimed_by: str,
    run_id: str,
    unit_key: str,
    mention: OrganizationMention | PersonMention,
    issue_areas: Sequence[str],
    today: date,
    organization_unit_key: str | None = None,
) -> ResolutionSummary:
    """Publish one prepared mention atomically with its immutable receipt.

    Parameters
    ----------
    conn
        Invocation-owned connection with no unrelated pending transaction.
    job_id, claimed_by, run_id
        Active job and unique invocation owner. The job row stays locked for
        this local database-only unit; no provider calls belong in this scope.
    unit_key
        Stable, nonempty ordinal key reused after interruption.
    mention, issue_areas, today
        Frozen prepared evidence, taxonomy and original research date.
    organization_unit_key
        Required for people: the matching completed organization unit. Omit
        for organizations. Its evidence and inputs must match exactly.

    Returns
    -------
    ResolutionSummary
        This unit's saved counts and entry identifier. Replay returns the same
        receipt without updating sources, profiles, roles or review history.
        It does not finalize run statistics or change queue/alarm state.
    """
    if not unit_key or isinstance(mention, PersonMention) != bool(organization_unit_key):
        msg = "A publication unit needs its key and exactly the person's organization key"
        raise ValueError(msg)
    fingerprint = _fingerprint(mention, issue_areas, today, organization_unit_key)
    fence = _Checkpoints(conn, job_id, claimed_by, run_id, fingerprint)
    try:
        await fence.fence()
        previous = await _receipt(conn, job_id, unit_key, fingerprint)
        if previous is not None:
            await conn.commit()
            return previous
        summary = ResolutionSummary()
        # Existing helpers are annotated with aiosqlite but use only execute
        # and commit here, as do the production PostgreSQL adapters.
        unit = cast("Connection", _UnitConnection(conn))
        if isinstance(mention, OrganizationMention):
            await _store_organization(unit, mention, issue_areas, today, summary)
        else:
            assert organization_unit_key is not None
            organization = await _receipt(
                conn,
                job_id,
                organization_unit_key,
                _fingerprint(mention.organization, issue_areas, today, None),
            )
            if organization is None:
                msg = "The organization must be published before its person mention"
                raise ValueError(msg)  # noqa: TRY301 - rollback belongs to the enclosing unit
            await _store_person(
                unit, mention, organization.entry_ids[0], issue_areas, today, summary
            )
        # Expiration while local work was running must roll back its writes.
        await fence.fence()
        await conn.execute(
            "INSERT INTO discovery_web_checkpoints (job_id, unit_key, fingerprint, result) VALUES (?, ?, ?, ?)",
            (job_id, _PREFIX + unit_key, fingerprint, _SUMMARY_CODEC.dump_json(summary).decode()),
        )
        await conn.commit()
    except BaseException:
        # A lost commit acknowledgement can leave no open transaction. Keep
        # the original failure; a fresh invocation resolves it from the receipt.
        with suppress(Exception):
            await conn.execute("ROLLBACK")
        raise
    else:
        return summary
