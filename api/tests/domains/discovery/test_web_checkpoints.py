"""Durable web discovery retains source evidence across worker invocations."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from atlas_shared import RawEntry

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineJob
from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings


async def _claim(conn) -> tuple[str, DiscoveryPipelineJob]:
    run_id = await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )
    job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
    await DiscoveryJobCRUD.claim_next(conn, claimed_by="alarm-1")
    return job_id, DiscoveryPipelineJob(run_id, "Las Vegas, NV", "NV", ["housing_affordability"])


def _settings() -> Settings:
    return Settings(_env_file=None, discovery_max_queries_per_run=2)


@pytest.mark.asyncio
async def test_one_unit_resumes_without_repeating_completed_calls(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)
    source = FetchedSource(
        "https://example.org/story", "Story", None, None, "source text", "report"
    )
    fetch = AsyncMock(return_value=[source])
    extract = AsyncMock(
        return_value=[RawEntry(name="Housing Coalition", entry_type="organization")]
    )
    monkeypatch.setattr(web, "fetch_sources", fetch)
    monkeypatch.setattr(web, "extract_entries", extract)
    results = [
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
        for _ in range(4)
    ]
    assert [result is None for result in results] == [True, True, False, False]
    assert fetch.await_count == 2
    assert extract.await_count == 1
    result = results[-1]
    assert result.sources == [source]
    assert result.entries[0]["source_urls"] == [source.url]
    assert result.entries[0]["source_contexts"] == {source.url: ""}
    cursor = await test_db.execute("SELECT kind, COUNT(*) FROM cost_ledger GROUP BY kind")
    assert dict(await cursor.fetchall()) == {"search": 2, "llm": 1}


@pytest.mark.asyncio
async def test_lost_owner_cannot_read_or_write_completed_units(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(web, "fetch_sources", fetch)
    await web.advance_web_discovery(
        test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
    )
    await test_db.execute(
        "UPDATE discovery_jobs SET claimed_by = 'alarm-2' WHERE id = ?", (job_id,)
    )
    await test_db.commit()
    with pytest.raises(web.CheckpointLeaseLostError):
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
    assert fetch.await_count == 1


@pytest.mark.asyncio
async def test_interrupted_unit_retries_only_it_and_retains_attempt_cost(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)
    fetch = AsyncMock(side_effect=[[], TimeoutError(), []])
    monkeypatch.setattr(web, "fetch_sources", fetch)
    arguments = {"job_id": job_id, "claimed_by": "alarm-1", "job": job, "settings": _settings()}
    assert await web.advance_web_discovery(test_db, **arguments) is None
    with pytest.raises(TimeoutError):
        await web.advance_web_discovery(test_db, **arguments)
    assert await web.advance_web_discovery(test_db, **arguments) is not None
    assert fetch.await_count == 3
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger WHERE kind = 'search'")
    assert (await cursor.fetchone())[0] == 3


@pytest.mark.asyncio
async def test_new_connection_and_owner_resume_persisted_evidence(
    test_db, db_url, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.platform.database import get_db_connection

    job_id, job = await _claim(test_db)
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(web, "fetch_sources", fetch)
    assert (
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
        is None
    )
    await test_db.execute(
        "UPDATE discovery_jobs SET claimed_by = 'alarm-2' WHERE id = ?", (job_id,)
    )
    await test_db.commit()
    connection = await get_db_connection(db_url)
    try:
        result = await web.advance_web_discovery(
            connection, job_id=job_id, claimed_by="alarm-2", job=job, settings=_settings()
        )
    finally:
        await connection.close()
    assert result is not None
    assert result.sources == []
    assert fetch.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["cancelled", "expired", "wrong-run", "changed-inputs"])
async def test_invalid_lease_or_inputs_never_invoke_providers(test_db, monkeypatch, change) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(web, "fetch_sources", fetch)
    await web.advance_web_discovery(
        test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
    )
    expected = web.CheckpointLeaseLostError
    if change == "cancelled":
        await DiscoveryJobCRUD.cancel(test_db, job_id)
    elif change == "expired":
        await test_db.execute(
            "UPDATE discovery_jobs SET claimed_until = '2000-01-01T00:00:00+00:00' WHERE id = ?",
            (job_id,),
        )
        await test_db.commit()
    elif change == "wrong-run":
        job = replace(job, run_id="another-run")
    else:
        job = replace(job, location_query="different private target")
        expected = web.CheckpointInputsChangedError
    with pytest.raises(expected) as failure:
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
    assert "private target" not in str(failure.value)
    assert fetch.await_count == 1


@pytest.mark.asyncio
async def test_lease_lost_during_provider_work_cannot_save_result(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)

    async def reassigned(*_args: object) -> list[FetchedSource]:
        await test_db.execute(
            "UPDATE discovery_jobs SET claimed_by = 'alarm-2' WHERE id = ?", (job_id,)
        )
        await test_db.commit()
        return []

    monkeypatch.setattr(web, "fetch_sources", reassigned)
    with pytest.raises(web.CheckpointLeaseLostError):
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
    cursor = await test_db.execute(
        "SELECT unit_key FROM discovery_web_checkpoints WHERE job_id = ?", (job_id,)
    )
    assert await cursor.fetchall() == [("manifest",)]


@pytest.mark.asyncio
async def test_deadline_cancels_current_unit_and_keeps_attempt_metered(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)
    cancelled = asyncio.Event()

    async def stuck(*_args: object) -> None:
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(web, "fetch_sources", stuck)
    monkeypatch.setattr(web, "_UNIT_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(TimeoutError):
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
    assert cancelled.is_set()
    cursor = await test_db.execute(
        "SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (job.run_id,)
    )
    assert (await cursor.fetchone())[0] == 1


@pytest.mark.asyncio
async def test_empty_query_plan_completes_without_provider_or_cost(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    job_id, job = await _claim(test_db)
    fetch = AsyncMock()
    monkeypatch.setattr(web, "fetch_sources", fetch)
    settings = _settings().model_copy(update={"discovery_max_queries_per_run": 0})
    result = await web.advance_web_discovery(
        test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=settings
    )
    assert result is not None
    assert result.queries == []
    fetch.assert_not_awaited()
    cursor = await test_db.execute(
        "SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (job.run_id,)
    )
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_prepared_web_uses_existing_registry_and_publication_gates(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import runner
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.registry_stage import RegistryDiscovery
    from atlas.domains.moderation.review_queue import ReviewQueueCRUD
    from atlas.models import EntryCRUD

    job_id, job = await _claim(test_db)
    source = FetchedSource(
        "https://example.org/story", "Story", None, None, "source text", "report"
    )
    monkeypatch.setattr(web, "fetch_sources", AsyncMock(return_value=[source]))
    monkeypatch.setattr(
        web,
        "extract_entries",
        AsyncMock(
            return_value=[
                RawEntry(
                    name="Housing Coalition",
                    entry_type="organization",
                    city="Las Vegas",
                    state="NV",
                    description="A coalition working for affordable housing.",
                    extraction_context="Housing Coalition",
                )
            ]
        ),
    )
    prepared = None
    for _ in range(3):
        prepared = await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=_settings()
        )
    assert prepared is not None
    fetch = AsyncMock(side_effect=AssertionError("completed web search repeated"))
    extract = AsyncMock(side_effect=AssertionError("completed extraction repeated"))
    registry = AsyncMock(return_value=RegistryDiscovery())
    monkeypatch.setattr(runner, "fetch_sources", fetch)
    monkeypatch.setattr(runner, "extract_entries", extract)
    monkeypatch.setattr(runner, "discover_from_registry", registry)
    await runner.run_discovery_pipeline(
        test_db, job=job, settings=_settings(), prepared_web=prepared
    )
    fetch.assert_not_awaited()
    extract.assert_not_awaited()
    registry.assert_awaited_once()
    run = await DiscoveryRunCRUD.get_by_id(test_db, job.run_id)
    assert run.status == "completed"
    assert run.entries_extracted == 1
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert len(pending) == 1
    assert pending[0].hold_reason == "uncorroborated_web_only"
    held, sources = await EntryCRUD.get_with_sources(test_db, pending[0].entity_id)
    assert held.active is False
    assert [item["url"] for item in sources] == [source.url]
    cursor = await test_db.execute(
        "SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (job.run_id,)
    )
    assert (await cursor.fetchone())[0] == 3
    with pytest.raises(web.CheckpointInputsChangedError):
        await runner.run_discovery_pipeline(
            test_db, job=replace(job, state="CA"), settings=_settings(), prepared_web=prepared
        )


@pytest.mark.asyncio
async def test_kill_switch_prevents_new_cost_and_releases_fence(
    test_db, db_url, monkeypatch
) -> None:
    from atlas.domains.discovery.cost import CostCeilingExceeded
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.platform.database import get_db_connection

    job_id, job = await _claim(test_db)
    fetch = AsyncMock()
    monkeypatch.setattr(web, "fetch_sources", fetch)
    settings = _settings().model_copy(update={"discovery_cost_kill_switch": True})
    with pytest.raises(CostCeilingExceeded):
        await web.advance_web_discovery(
            test_db, job_id=job_id, claimed_by="alarm-1", job=job, settings=settings
        )
    fetch.assert_not_awaited()
    other = await get_db_connection(db_url)
    try:
        async with asyncio.timeout(2):
            assert await DiscoveryJobCRUD.cancel(other, job_id)
    finally:
        await other.close()
    cursor = await test_db.execute(
        "SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (job.run_id,)
    )
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_credentials_stay_out_of_checkpoint_evidence(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineCredentials

    job_id, job = await _claim(test_db)
    credentials = DiscoveryPipelineCredentials("test-search-secret", "test-model-secret")
    monkeypatch.setattr(web, "fetch_sources", AsyncMock(return_value=[]))
    for _ in range(2):
        await web.advance_web_discovery(
            test_db,
            job_id=job_id,
            claimed_by="alarm-1",
            job=job,
            settings=_settings(),
            credentials=credentials,
        )
    cursor = await test_db.execute(
        "SELECT result FROM discovery_web_checkpoints WHERE job_id = ?", (job_id,)
    )
    for (result,) in await cursor.fetchall():
        assert "test-search-secret" not in result
        assert "test-model-secret" not in result
