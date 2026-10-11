"""Web publication receipts preserve source-backed review through retries."""

from __future__ import annotations

from datetime import date

import pytest
from atlas_shared import DeduplicatedEntry, PageContent, RankedEntry

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.models import DiscoveryRunCRUD


def _entry() -> RankedEntry:
    return RankedEntry(
        entry=DeduplicatedEntry(
            name="Housing Trust",
            entry_type="organization",
            description="Housing support.",
            city="Las Vegas",
            state="NV",
            issue_areas=["housing_affordability"],
            source_urls=["https://example.org/story"],
            source_contexts={"https://example.org/story": "Housing support."},
        ),
        score=0.8,
        components={},
    )


async def _claim(conn) -> tuple[str, str]:
    run = await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )
    job = await DiscoveryJobCRUD.create(conn, run_id=run)
    await DiscoveryJobCRUD.claim_next(conn, claimed_by="first")
    return run, job


@pytest.mark.asyncio
async def test_web_receipt_preserves_hold_source_and_original_observation_date(test_db) -> None:
    from atlas.domains.discovery.pipeline.web_publication import publish_web_entry
    from atlas.domains.moderation.review_queue import ReviewQueueCRUD
    from atlas.models import EntryCRUD

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "index": 0,
        "ranked": _entry(),
        "sources": [
            PageContent(
                url="https://example.org/story", title="Housing report", text="Public evidence"
            )
        ],
        "today": date(2025, 1, 2),
    }
    receipt = await publish_web_entry(test_db, **args)
    entry, sources = await EntryCRUD.get_with_sources(test_db, receipt.entry_id)
    assert not entry.active
    assert entry.first_seen == entry.last_seen == date(2025, 1, 2)
    assert [source["url"] for source in sources] == ["https://example.org/story"]
    review = await ReviewQueueCRUD.list_pending(test_db)
    assert review[0].hold_reason == "uncorroborated_web_only"
    await test_db.execute(
        "UPDATE review_queue SET status = 'rejected' WHERE entity_id = ?", (receipt.entry_id,)
    )
    await EntryCRUD.update(test_db, receipt.entry_id, description="Curated description")
    assert await publish_web_entry(test_db, **args) == receipt
    assert (
        await EntryCRUD.get_by_id(test_db, receipt.entry_id)
    ).description == "Curated description"
    assert await ReviewQueueCRUD.list_pending(test_db) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["source", "date", "gate", "candidate", "owner", "index"])
async def test_changed_web_inputs_fail_closed(test_db, change) -> None:
    from atlas.domains.discovery.pipeline.web_checkpoints import (
        CheckpointInputsChangedError,
        CheckpointLeaseLostError,
    )
    from atlas.domains.discovery.pipeline.web_publication import publish_web_entry

    run, job = await _claim(test_db)
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "index": 0,
        "ranked": _entry(),
        "sources": [PageContent(url="https://example.org/story", text="Evidence")],
        "today": date(2026, 10, 10),
    }
    await publish_web_entry(test_db, **args)
    if change == "source":
        args["sources"] = [PageContent(url="https://example.org/story", text="Changed evidence")]
    elif change == "date":
        args["today"] = date(2026, 10, 11)
    elif change == "gate":
        args["dedup_note"] = "Possible duplicate"
    elif change == "candidate":
        args["ranked"] = _entry().model_copy(update={"score": 0.2})
    elif change == "owner":
        args["claimed_by"] = "other"
    else:
        args["index"] = -1
    with pytest.raises((ValueError, CheckpointInputsChangedError, CheckpointLeaseLostError)):
        await publish_web_entry(test_db, **args)


@pytest.mark.asyncio
async def test_failed_source_link_rolls_back_entry_review_and_receipt(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_publication as publication

    run, job = await _claim(test_db)
    original = publication._persist_sources

    async def fail(*args: object, **kwargs: object) -> set[str]:
        await original(*args, **kwargs)
        msg = "source interrupted"
        raise RuntimeError(msg)

    monkeypatch.setattr(publication, "_persist_sources", fail)
    with pytest.raises(RuntimeError, match="source interrupted"):
        await publication.publish_web_entry(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            index=0,
            ranked=_entry(),
            sources=[],
            today=date(2026, 10, 10),
        )
    for table in ["entries", "sources", "review_queue", "discovery_web_checkpoints"]:
        cursor = await test_db.execute(f"SELECT COUNT(*) FROM {table}")
        assert (await cursor.fetchone())[0] == 0
