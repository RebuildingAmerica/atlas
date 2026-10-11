"""Complete a discovery run only with its exact committed publication receipts."""

from __future__ import annotations

import hashlib
import json
from contextlib import suppress
from typing import TYPE_CHECKING, cast

from atlas_shared import DiscoveryRunArtifacts, DiscoveryRunStats, DiscoveryRunStatus
from pydantic import BaseModel

from atlas.domains.discovery.resolution.mentions import OrganizationMention, PersonMention
from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.database import db

from .registry_publication import _MENTION_CODEC, _fingerprint, _receipt, _UnitConnection
from .runner_persistence import _build_research_summary
from .web_checkpoints import CheckpointInputsChangedError, CheckpointLeaseLostError, _Checkpoints
from .web_publication import web_publication_fingerprint, web_publication_receipt

if TYPE_CHECKING:
    from datetime import date

    from aiosqlite import Connection

    from .registry_stage import RegistryDiscovery

_KEY = "publication:complete"


class DiscoveryCompletionReceipt(BaseModel):
    """Final counts and catalog references committed with run/job completion."""

    entry_ids: list[str]
    stats: DiscoveryRunStats


def _registry_mentions(registry: RegistryDiscovery) -> list[OrganizationMention | PersonMention]:
    return [*registry.organizations, *registry.people]


def _completion_fingerprint(
    artifacts: DiscoveryRunArtifacts,
    registry: RegistryDiscovery,
    today: date,
    dedup_notes: list[str | None],
    empty_fetch_reason: str | None,
) -> str:
    return hashlib.sha256(
        json.dumps(
            {
                "version": 1,
                "artifacts": artifacts.model_dump(mode="json"),
                "registry": [
                    _MENTION_CODEC.dump_python(item, mode="json")
                    for item in _registry_mentions(registry)
                ],
                "today": today.isoformat(),
                "dedup_notes": dedup_notes,
                "empty_fetch_reason": empty_fetch_reason,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


async def _lock_completion(
    conn: Connection, job_id: str, claimed_by: str, run_id: str, fingerprint: str
) -> DiscoveryCompletionReceipt | None:
    # A terminal replay only reads a matching receipt. It cannot rerun writes
    # under a cleared lease, or revive a cancelled/failed job.
    locked = await conn.execute(
        "UPDATE discovery_jobs SET claimed_until = claimed_until WHERE id = ? AND run_id = ? AND (status = 'completed' OR (claimed_by = ? AND status IN ('claimed', 'running') AND claimed_until > ?))",
        (job_id, run_id, claimed_by, db.now_iso()),
    )
    if locked.rowcount != 1:
        raise CheckpointLeaseLostError
    cursor = await conn.execute(
        "SELECT c.fingerprint, c.result FROM discovery_web_checkpoints c WHERE c.job_id = ? AND c.unit_key = ?",
        (job_id, _KEY),
    )
    row = await cursor.fetchone()
    if row is not None:
        if row[0] != fingerprint:
            raise CheckpointInputsChangedError
        return DiscoveryCompletionReceipt.model_validate_json(row[1])
    # Completed rows without this receipt belong to another execution path.
    await _Checkpoints(conn, job_id, claimed_by, run_id, fingerprint).fence()
    return None


async def _publication_ids(  # noqa: PLR0913
    conn: Connection,
    job_id: str,
    artifacts: DiscoveryRunArtifacts,
    registry: RegistryDiscovery,
    today: date,
    dedup_notes: list[str | None],
) -> tuple[list[str], list[str], set[str]]:
    web_ids: list[str] = []
    registry_ids: list[str] = []
    urls: set[str] = set()
    for index, ranked in enumerate(artifacts.ranked_entries):
        web = await web_publication_receipt(
            conn,
            job_id,
            index,
            web_publication_fingerprint(ranked, artifacts.sources, today, dedup_notes[index]),
        )
        if web is None:
            msg = "Required web publication receipt is missing"
            raise ValueError(msg)
        web_ids.append(web.entry_id)
        urls.update(web.source_urls)
    organizations = {
        organization.ein: index for index, organization in enumerate(registry.organizations)
    }
    for index, mention in enumerate(_registry_mentions(registry)):
        if isinstance(mention, PersonMention):
            key = f"person:{index - len(registry.organizations)}"
            parent = f"org:{organizations[mention.organization.ein]}"
        else:
            key = f"org:{index}"
            parent = None
        receipt = await _receipt(
            conn,
            job_id,
            key,
            _fingerprint(mention, artifacts.manifest.run.issue_areas, today, parent),
        )
        if receipt is None:
            msg = "Required registry publication receipt is missing"
            raise ValueError(msg)
        registry_ids.extend(receipt.entry_ids)
    return web_ids, registry_ids, urls


async def finalize_discovery_job(  # noqa: PLR0913
    conn: Connection,
    *,
    job_id: str,
    claimed_by: str,
    run_id: str,
    artifacts: DiscoveryRunArtifacts,
    registry: RegistryDiscovery,
    today: date,
    dedup_notes: list[str | None],
    empty_fetch_reason: str | None = None,
) -> DiscoveryCompletionReceipt:
    """Atomically finalize statistics, research summary, job and completion receipt.

    Parameters
    ----------
    conn
        Invocation-owned connection without unrelated pending writes.
    job_id, claimed_by, run_id
        Active job lease. A completed matching receipt can be read after its
        owner is cleared, resolving a lost final commit acknowledgement.
    artifacts, registry, today, dedup_notes, empty_fetch_reason
        Frozen prepared inputs. Registry keys must be org:N and person:N in
        their original order; web keys use each ranked result's ordinal.

    Returns
    -------
    DiscoveryCompletionReceipt
        Exact committed completion. Missing or changed publication receipts
        fail before any run or job can become completed.
    """
    if (
        artifacts.stats.status != DiscoveryRunStatus.COMPLETED
        or artifacts.manifest.status != DiscoveryRunStatus.COMPLETED
        or artifacts.manifest.sync is None
        or artifacts.manifest.sync.remote_run_id != run_id
        or len(dedup_notes) != len(artifacts.ranked_entries)
    ):
        msg = "Completion requires a matching completed artifact bundle and gate signals"
        raise ValueError(msg)
    fingerprint = _completion_fingerprint(
        artifacts, registry, today, dedup_notes, empty_fetch_reason
    )
    try:
        previous = await _lock_completion(conn, job_id, claimed_by, run_id, fingerprint)
        if previous is not None:
            await conn.commit()
            return previous
        web_ids, registry_ids, urls = await _publication_ids(
            conn, job_id, artifacts, registry, today, dedup_notes
        )
        all_ids = [*web_ids, *registry_ids]
        present_ids = [
            entry_id
            for entry_id in all_ids
            if await EntryCRUD.get_by_id(conn, entry_id) is not None
        ]
        stats = artifacts.stats.model_copy(
            update={
                "entries_confirmed": len(present_ids),
                "sources_processed": artifacts.stats.sources_processed
                or artifacts.stats.sources_fetched
                or len(urls),
            }
        )
        unit = cast("Connection", _UnitConnection(conn))
        await DiscoveryRunCRUD.complete(
            unit, run_id, **stats.model_dump(exclude={"status", "error_message"})
        )
        summary = await _build_research_summary(
            unit, artifacts=artifacts, confirmed_entry_ids=web_ids
        )
        await DiscoveryRunCRUD.update_research_summary(unit, run_id, summary)
        if not artifacts.sources:
            await DiscoveryRunCRUD.note_empty_fetch(
                unit,
                run_id=run_id,
                reason=empty_fetch_reason or "Search returned no results and reported no failure.",
            )
        await _Checkpoints(conn, job_id, claimed_by, run_id, fingerprint).fence()
        receipt = DiscoveryCompletionReceipt(entry_ids=all_ids, stats=stats)
        await conn.execute(
            "INSERT INTO discovery_web_checkpoints (job_id, unit_key, fingerprint, result) VALUES (?, ?, ?, ?)",
            (job_id, _KEY, fingerprint, receipt.model_dump_json()),
        )
        await conn.execute(
            "UPDATE discovery_jobs SET status = 'completed', completed_at = ?, claimed_by = NULL, claimed_until = NULL, next_attempt_at = NULL WHERE id = ?",
            (db.now_iso(), job_id),
        )
        await conn.commit()
    except BaseException:
        with suppress(Exception):
            await conn.execute("ROLLBACK")
        raise
    else:
        return receipt
