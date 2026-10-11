"""Publish one web result and its exact retry receipt in the same transaction."""

from __future__ import annotations

import hashlib
import json
from contextlib import suppress
from typing import TYPE_CHECKING, cast

from pydantic import BaseModel

from .registry_publication import _UnitConnection
from .runner_storage_persistence import _persist_issue_areas, _persist_sources, _upsert_entry
from .web_checkpoints import CheckpointInputsChangedError, _Checkpoints

if TYPE_CHECKING:
    from datetime import date

    from aiosqlite import Connection
    from atlas_shared import PageContent, RankedEntry


class WebPublicationReceipt(BaseModel):
    """Committed catalog identifier and the sources attached by this unit."""

    entry_id: str
    source_urls: list[str]


def web_publication_fingerprint(
    ranked: RankedEntry, sources: list[PageContent], today: date, dedup_note: str | None
) -> str:
    """Bind a receipt to the frozen candidate, gate signals, date and source text."""
    source_by_url = {source.url: source for source in sources}
    return hashlib.sha256(
        json.dumps(
            {
                "version": 1,
                "ranked": ranked.model_dump(mode="json"),
                "today": today.isoformat(),
                "dedup_note": dedup_note,
                "sources": [
                    source_by_url[url].model_dump(mode="json")
                    for url in sorted(set(ranked.entry.source_urls))
                    if url in source_by_url
                ],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


async def web_publication_receipt(
    conn: Connection, job_id: str, index: int, fingerprint: str
) -> WebPublicationReceipt | None:
    """Read an exact receipt inside a caller-owned job-fenced transaction."""
    cursor = await conn.execute(
        "SELECT fingerprint, result FROM discovery_web_checkpoints WHERE job_id = ? AND unit_key = ?",
        (job_id, f"publication:web:{index}"),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    if row[0] != fingerprint:
        raise CheckpointInputsChangedError
    return WebPublicationReceipt.model_validate_json(row[1])


async def publish_web_entry(  # noqa: PLR0913
    conn: Connection,
    *,
    job_id: str,
    claimed_by: str,
    run_id: str,
    index: int,
    ranked: RankedEntry,
    sources: list[PageContent],
    today: date,
    dedup_note: str | None = None,
) -> WebPublicationReceipt:
    """Commit one candidate with existing trust/review rules and a replay receipt.

    Parameters
    ----------
    conn
        Invocation-owned connection with no unrelated pending writes.
    job_id, claimed_by, run_id
        Active job lease and unique invocation owner.
    index
        Stable nonnegative ordinal in the frozen ranked artifact bundle.
    ranked, sources, today, dedup_note
        Frozen candidate, source evidence, research date and duplicate signal.

    Returns
    -------
    WebPublicationReceipt
        Saved result without reapplying any review changes on replay.
    """
    if index < 0:
        msg = "Publication index must be nonnegative"
        raise ValueError(msg)
    fingerprint = web_publication_fingerprint(ranked, sources, today, dedup_note)
    fence = _Checkpoints(conn, job_id, claimed_by, run_id, fingerprint)
    try:
        await fence.fence()
        receipt = await web_publication_receipt(conn, job_id, index, fingerprint)
        if receipt is not None:
            await conn.commit()
            return receipt
        unit = cast("Connection", _UnitConnection(conn))
        # Existing helpers use the current date only when evidence has no date.
        # Supply the original research date so a resumed run cannot drift days.
        entry = ranked.entry.model_copy(
            update={
                "source_dates": ranked.entry.source_dates or [today],
                "last_seen": ranked.entry.last_seen or today,
            }
        )
        entry_id = await _upsert_entry(
            unit,
            entry,
            score=ranked.score,
            dedup_suspect=dedup_note is not None,
            dedup_note=dedup_note,
        )
        await _persist_issue_areas(unit, entry_id, entry.issue_areas)
        linked = await _persist_sources(
            unit,
            entry_id=entry_id,
            entry=entry,
            source_by_url={source.url: source for source in sources},
        )
        receipt = WebPublicationReceipt(entry_id=entry_id, source_urls=sorted(linked))
        await fence.fence()
        await conn.execute(
            "INSERT INTO discovery_web_checkpoints (job_id, unit_key, fingerprint, result) VALUES (?, ?, ?, ?)",
            (job_id, f"publication:web:{index}", fingerprint, receipt.model_dump_json()),
        )
        await conn.commit()
    except BaseException:
        with suppress(Exception):
            await conn.execute("ROLLBACK")
        raise
    else:
        return receipt
