"""Final statistics, research evidence and queue completion commit together."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from atlas_shared import DiscoveryRunArtifacts, DiscoveryRunStats, PageContent

from atlas.domains.discovery.pipeline.registry_stage import RegistryDiscovery
from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineJob
from atlas.domains.discovery.pipeline.runner_storage_artifacts import _build_discovery_run_artifacts
from atlas.models import DiscoveryRunCRUD

from .test_web_publication import _claim, _entry


def _artifacts(run: str) -> DiscoveryRunArtifacts:
    return _build_discovery_run_artifacts(
        job=DiscoveryPipelineJob(run, "Las Vegas, NV", "NV", ["housing_affordability"]),
        started_at=datetime(2026, 10, 10, tzinfo=UTC),
        completed_at=datetime(2026, 10, 10, tzinfo=UTC),
        stats=DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=1,
            sources_processed=1,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
        ),
        raw_entries=[],
        ranked_entries=[_entry()],
        sources=[
            PageContent(url="https://example.org/story", title="Housing report", text="Evidence")
        ],
    )


@pytest.mark.asyncio
async def test_missing_publication_cannot_finish_run_or_job(test_db) -> None:
    from atlas.domains.discovery.models import DiscoveryJobCRUD
    from atlas.domains.discovery.pipeline.discovery_completion import finalize_discovery_job

    run, job = await _claim(test_db)
    with pytest.raises(ValueError, match="publication receipt"):
        await finalize_discovery_job(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            artifacts=_artifacts(run),
            registry=RegistryDiscovery(),
            today=date(2026, 10, 10),
            dedup_notes=[None],
        )
    assert (await DiscoveryJobCRUD.get_by_id(test_db, job)).status == "claimed"
    assert (await DiscoveryRunCRUD.get_by_id(test_db, run)).status != "completed"


@pytest.mark.asyncio
async def test_final_stats_and_summary_match_published_receipts(test_db) -> None:
    from atlas.domains.discovery.models import DiscoveryJobCRUD
    from atlas.domains.discovery.pipeline.discovery_completion import finalize_discovery_job
    from atlas.domains.discovery.pipeline.web_publication import publish_web_entry

    run, job = await _claim(test_db)
    artifacts = _artifacts(run)
    publication = await publish_web_entry(
        test_db,
        job_id=job,
        claimed_by="first",
        run_id=run,
        index=0,
        ranked=artifacts.ranked_entries[0],
        sources=artifacts.sources,
        today=date(2026, 10, 10),
    )
    result = await finalize_discovery_job(
        test_db,
        job_id=job,
        claimed_by="first",
        run_id=run,
        artifacts=artifacts,
        registry=RegistryDiscovery(),
        today=date(2026, 10, 10),
        dedup_notes=[None],
    )
    assert result.entry_ids == [publication.entry_id]
    saved = await DiscoveryRunCRUD.get_by_id(test_db, run)
    assert saved.status == "completed"
    assert saved.entries_confirmed == 1
    assert saved.research_summary["ranked_leads"][0]["entry_id"] == publication.entry_id
    queue = await DiscoveryJobCRUD.get_by_id(test_db, job)
    assert queue.status == "completed"
    assert queue.claimed_by is None
    assert queue.claimed_until is None
    assert (
        await finalize_discovery_job(
            test_db,
            job_id=job,
            claimed_by="new-invocation",
            run_id=run,
            artifacts=artifacts,
            registry=RegistryDiscovery(),
            today=date(2026, 10, 10),
            dedup_notes=[None],
        )
        == result
    )


@pytest.mark.asyncio
async def test_final_failure_rolls_back_run_and_job_but_keeps_publications(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.models import DiscoveryJobCRUD
    from atlas.domains.discovery.pipeline import discovery_completion as completion
    from atlas.domains.discovery.pipeline.web_publication import publish_web_entry

    run, job = await _claim(test_db)
    artifacts = _artifacts(run)
    await publish_web_entry(
        test_db,
        job_id=job,
        claimed_by="first",
        run_id=run,
        index=0,
        ranked=artifacts.ranked_entries[0],
        sources=artifacts.sources,
        today=date(2026, 10, 10),
    )
    original = completion.DiscoveryRunCRUD.update_research_summary

    async def fail(*args: object, **kwargs: object) -> bool:
        await original(*args, **kwargs)
        msg = "summary interrupted"
        raise RuntimeError(msg)

    monkeypatch.setattr(completion.DiscoveryRunCRUD, "update_research_summary", fail)
    with pytest.raises(RuntimeError, match="summary interrupted"):
        await completion.finalize_discovery_job(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            artifacts=artifacts,
            registry=RegistryDiscovery(),
            today=date(2026, 10, 10),
            dedup_notes=[None],
        )
    saved = await DiscoveryRunCRUD.get_by_id(test_db, run)
    assert saved.status != "completed"
    assert not saved.research_summary
    assert (await DiscoveryJobCRUD.get_by_id(test_db, job)).status == "claimed"
    cursor = await test_db.execute(
        "SELECT unit_key FROM discovery_web_checkpoints WHERE job_id = ?", (job,)
    )
    assert await cursor.fetchall() == [("publication:web:0",)]


@pytest.mark.asyncio
async def test_final_ack_loss_replays_after_owner_cleared_and_rejects_changed_bundle(
    test_db, db_url
) -> None:
    from atlas.domains.discovery.pipeline.discovery_completion import finalize_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointInputsChangedError
    from atlas.platform.database import get_db_connection

    run, job = await _claim(test_db)
    artifacts = _artifacts(run).model_copy(
        update={"ranked_entries": [], "sources": [], "stats": DiscoveryRunStats()}
    )
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "artifacts": artifacts,
        "registry": RegistryDiscovery(),
        "today": date(2026, 10, 10),
        "dedup_notes": [],
        "empty_fetch_reason": "Search quota exhausted",
    }

    class LostAcknowledgement:
        execute = test_db.execute

        async def commit(self) -> None:
            await test_db.commit()
            msg = "final acknowledgement lost"
            raise ConnectionError(msg)

    with pytest.raises(ConnectionError, match="acknowledgement"):
        await finalize_discovery_job(LostAcknowledgement(), **args)
    conn = await get_db_connection(db_url)
    try:
        args["claimed_by"] = "replacement"
        result = await finalize_discovery_job(conn, **args)
        assert result.entry_ids == []
        assert result.stats.entries_confirmed == 0
        assert (
            await DiscoveryRunCRUD.get_by_id(conn, run)
        ).error_message == "Search quota exhausted"
        args["empty_fetch_reason"] = "Changed reason"
        with pytest.raises(CheckpointInputsChangedError):
            await finalize_discovery_job(conn, **args)
    finally:
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["cancelled", "owner", "completed_without_receipt"])
async def test_inactive_job_cannot_be_finalized(test_db, state) -> None:
    from atlas.domains.discovery.models import DiscoveryJobCRUD
    from atlas.domains.discovery.pipeline.discovery_completion import finalize_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    run, job = await _claim(test_db)
    if state == "cancelled":
        await DiscoveryJobCRUD.cancel(test_db, job)
    elif state == "completed_without_receipt":
        await DiscoveryJobCRUD.complete(test_db, job)
    with pytest.raises(CheckpointLeaseLostError):
        await finalize_discovery_job(
            test_db,
            job_id=job,
            claimed_by="other" if state == "owner" else "first",
            run_id=run,
            artifacts=_artifacts(run),
            registry=RegistryDiscovery(),
            today=date(2026, 10, 10),
            dedup_notes=[None],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["status", "manifest_status", "sync", "run", "notes"])
async def test_invalid_completion_bundle_cannot_change_run(test_db, change) -> None:
    from atlas_shared import DiscoveryRunStatus

    from atlas.domains.discovery.pipeline.discovery_completion import finalize_discovery_job

    run, job = await _claim(test_db)
    artifacts = _artifacts(run)
    notes = [None]
    if change == "status":
        artifacts.stats.status = DiscoveryRunStatus.FAILED
    elif change == "manifest_status":
        artifacts.manifest.status = DiscoveryRunStatus.FAILED
    elif change == "sync":
        artifacts.manifest.sync = None
    elif change == "run":
        artifacts.manifest.sync.remote_run_id = "other"
    else:
        notes = []
    with pytest.raises(ValueError, match="matching completed"):
        await finalize_discovery_job(
            test_db,
            job_id=job,
            claimed_by="first",
            run_id=run,
            artifacts=artifacts,
            registry=RegistryDiscovery(),
            today=date(2026, 10, 10),
            dedup_notes=notes,
        )


@pytest.mark.asyncio
async def test_registry_receipts_are_required_in_order_and_included_in_final_counts(
    test_db,
) -> None:
    from atlas.domains.discovery.pipeline.discovery_completion import finalize_discovery_job
    from atlas.domains.discovery.pipeline.registry_publication import publish_registry_mention

    from .test_registry_publication import _organization, _person

    run, job = await _claim(test_db)
    artifacts = _artifacts(run).model_copy(
        update={
            "ranked_entries": [],
            "sources": [],
            "stats": DiscoveryRunStats(entries_extracted=2, entries_after_dedup=2),
        }
    )
    organization = _organization()
    person = _person(organization)
    registry = RegistryDiscovery(organizations=[organization], people=[person])
    args = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "artifacts": artifacts,
        "registry": registry,
        "today": date(2026, 10, 10),
        "dedup_notes": [],
    }
    with pytest.raises(ValueError, match="registry publication"):
        await finalize_discovery_job(test_db, **args)
    base = {
        "job_id": job,
        "claimed_by": "first",
        "run_id": run,
        "issue_areas": artifacts.manifest.run.issue_areas,
        "today": date(2026, 10, 10),
    }
    org = await publish_registry_mention(test_db, unit_key="org:0", mention=organization, **base)
    published_person = await publish_registry_mention(
        test_db, unit_key="person:0", mention=person, organization_unit_key="org:0", **base
    )
    result = await finalize_discovery_job(test_db, **args)
    assert result.entry_ids == [*org.entry_ids, *published_person.entry_ids]
    assert result.stats.entries_confirmed == 2
    saved = await DiscoveryRunCRUD.get_by_id(test_db, run)
    assert saved.entries_extracted == 2
    assert saved.error_message == "Search returned no results and reported no failure."
