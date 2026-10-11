"""One-turn scheduling preserves research, review, ownership and vendor spend."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings
from atlas.platform.database import get_db_connection


async def _enqueue(conn) -> tuple[str, str]:
    run = await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )
    job = await DiscoveryJobCRUD.create(conn, run_id=run)
    return run, job


def _settings(**changes: object) -> Settings:
    return Settings(
        _env_file=None,
        discovery_max_queries_per_run=1,
        discovery_registry_max_organizations=0,
        discovery_registry_max_people=0,
    ).model_copy(update=changes)


@pytest.mark.asyncio
async def test_fresh_turns_finish_with_same_source_hold_summary_and_once_only_costs(
    test_db, db_url, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
    from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
    from atlas.domains.moderation.review_queue import ReviewQueueCRUD

    run, job_id = await _enqueue(test_db)
    fetch = AsyncMock(
        return_value=[
            FetchedSource(
                "https://example.org/story",
                "Report",
                None,
                None,
                "Housing Trust provides Housing support.",
                "news_article",
            )
        ]
    )
    from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineCredentials

    from .test_extraction_checkpoints import _client, _reply

    extract, _, _ = _client(
        monkeypatch,
        [
            _reply('[{"name":"Housing Trust"}]'),
            _reply(
                '{"entries":[{"name":"Housing Trust","type":"organization",'
                '"description":"Housing support.","city":"Las Vegas","state":"NV",'
                '"issue_areas":["housing_affordability"],"extraction_context":"Housing support."}]}'
            ),
        ],
    )
    monkeypatch.setattr(web, "fetch_sources", fetch)
    phases = []
    for index in range(20):
        conn = await get_db_connection(db_url)
        try:
            owner = f"turn-{index}"
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by=owner, checkpointed=True)
            assert claimed.id == job_id
            result = await advance_claimed_discovery_job(
                conn,
                job_id=job_id,
                claimed_by=owner,
                settings=_settings(),
                credentials=DiscoveryPipelineCredentials(
                    anthropic_api_key="private", search_api_key="search"
                ),
            )
            phases.append(result.phase)
            if result.status == "completed":
                break
            assert result.status == "yielded"
            assert (await DiscoveryJobCRUD.get_by_id(conn, job_id)).retry_count == 0
            assert await DiscoveryJobCRUD.claim_next(conn, claimed_by="legacy") is None
        finally:
            await conn.close()
    assert result.status == "completed"
    assert fetch.await_count == 1
    assert extract.await_count == 2
    assert "registry" in phases
    assert "ranking" in phases
    saved = await DiscoveryRunCRUD.get_by_id(test_db, run)
    assert saved.status == "completed"
    assert saved.entries_confirmed == 1
    assert saved.research_summary["ranked_leads"][0]["name"] == "Housing Trust"
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert pending[0].hold_reason == "uncorroborated_web_only"
    cursor = await test_db.execute(
        "SELECT kind, COUNT(*) FROM cost_ledger WHERE run_id = ? GROUP BY kind ORDER BY kind",
        (run,),
    )
    assert await cursor.fetchall() == [("llm", 2), ("search", 1)]
    replay = await advance_claimed_discovery_job(
        test_db, job_id=job_id, claimed_by="after-completion", settings=_settings()
    )
    assert replay == result


@pytest.mark.asyncio
async def test_kill_switch_fails_run_and_queue_without_provider_or_retry(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job

    run, job_id = await _enqueue(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="turn", checkpointed=True)
    fetch = AsyncMock()
    monkeypatch.setattr(web, "fetch_sources", fetch)
    result = await advance_claimed_discovery_job(
        test_db,
        job_id=job_id,
        claimed_by="turn",
        settings=_settings(discovery_cost_kill_switch=True),
    )
    assert result.status == "failed"
    assert (
        await DiscoveryRunCRUD.get_by_id(test_db, run)
    ).error_message == "cost_ceiling:kill_switch"
    assert (await DiscoveryJobCRUD.get_by_id(test_db, job_id)).status == "failed"
    fetch.assert_not_awaited()
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (run,))
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_registry_publication_receipt_survives_lost_progress_save(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import continuation
    from atlas.domains.discovery.pipeline.registry_stage import RegistryDiscovery
    from atlas.domains.discovery.pipeline.web_checkpoints import _Checkpoints
    from atlas.models import EntryCRUD

    from .test_registry_publication import _organization, _person

    run, job_id = await _enqueue(test_db)
    organization = _organization()
    registry = RegistryDiscovery(organizations=[organization], people=[_person(organization)])
    prepared = AsyncMock(side_effect=[None, registry])
    monkeypatch.setattr(continuation, "advance_registry_discovery", prepared)
    original_save = _Checkpoints.save
    failed = False

    async def lose_save(self: object, key: str, value: object, adapter: object) -> None:
        nonlocal failed
        if (
            key == "continuation"
            and value.phase == "organizations"
            and value.index == 1
            and not failed
        ):
            failed = True
            msg = "progress acknowledgement lost"
            raise ConnectionError(msg)
        await original_save(self, key, value, adapter)

    monkeypatch.setattr(_Checkpoints, "save", lose_save)
    settings = _settings(discovery_max_queries_per_run=0)
    for index in range(20):
        owner = f"turn-{index}"
        claimed = await DiscoveryJobCRUD.claim_next(test_db, claimed_by=owner, checkpointed=True)
        assert claimed.id == job_id
        try:
            result = await continuation.advance_claimed_discovery_job(
                test_db, job_id=job_id, claimed_by=owner, settings=settings
            )
        except ConnectionError:
            cursor = await test_db.execute("SELECT id FROM entries WHERE type = 'organization'")
            entry_id = (await cursor.fetchone())[0]
            await EntryCRUD.update(test_db, entry_id, name="Curated Housing Trust")
            await test_db.execute(
                "UPDATE discovery_jobs SET claimed_until = '2000-01-01T00:00:00+00:00' WHERE id = ?",
                (job_id,),
            )
            await test_db.commit()
            assert await DiscoveryJobCRUD.claim_next(test_db, claimed_by="legacy") is None
            continue
        if result.status == "completed":
            break
    assert failed
    assert result.status == "completed"
    assert prepared.await_count == 2
    cursor = await test_db.execute("SELECT name FROM entries WHERE type = 'organization'")
    assert await cursor.fetchall() == [("Curated Housing Trust",)]
    assert (await DiscoveryRunCRUD.get_by_id(test_db, run)).entries_confirmed == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("retryable", [True, False])
async def test_provider_failure_keeps_attempt_cost_and_existing_backoff(
    test_db, monkeypatch, retryable
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job

    run, job_id = await _enqueue(test_db)
    if not retryable:
        await test_db.execute("UPDATE discovery_jobs SET max_retries = 0 WHERE id = ?", (job_id,))
        await test_db.commit()
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="first", checkpointed=True)
    fetch = AsyncMock(side_effect=RuntimeError("source unavailable"))
    monkeypatch.setattr(web, "fetch_sources", fetch)
    result = await advance_claimed_discovery_job(
        test_db, job_id=job_id, claimed_by="first", settings=_settings()
    )
    assert result.status == ("retry" if retryable else "failed")
    queued = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
    assert queued.retry_count == 1
    assert queued.claimed_by is None
    assert bool(queued.next_attempt_at) == retryable
    assert (
        await DiscoveryJobCRUD.claim_next(test_db, claimed_by="too-soon", checkpointed=True) is None
    )
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (run,))
    assert (await cursor.fetchone())[0] == 1
    if retryable:
        await test_db.execute(
            "UPDATE discovery_jobs SET next_attempt_at = NULL WHERE id = ?", (job_id,)
        )
        await test_db.commit()
        assert await DiscoveryJobCRUD.claim_next(test_db, claimed_by="legacy") is None
        await DiscoveryJobCRUD.claim_next(test_db, claimed_by="retry", checkpointed=True)
        fetch.side_effect = None
        fetch.return_value = []
        assert (
            await advance_claimed_discovery_job(
                test_db, job_id=job_id, claimed_by="retry", settings=_settings()
            )
        ).status == "yielded"
        cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (run,))
        assert (await cursor.fetchone())[0] == 2


@pytest.mark.asyncio
async def test_cancelled_provider_turn_cannot_requeue_or_publish(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    run, job_id = await _enqueue(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="first", checkpointed=True)

    async def cancel(*_args: object) -> list[object]:
        await DiscoveryJobCRUD.cancel(test_db, job_id)
        return []

    monkeypatch.setattr(web, "fetch_sources", cancel)
    with pytest.raises(CheckpointLeaseLostError):
        await advance_claimed_discovery_job(
            test_db, job_id=job_id, claimed_by="first", settings=_settings()
        )
    assert (await DiscoveryJobCRUD.get_by_id(test_db, job_id)).status == "cancelled"
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (run,))
    assert (await cursor.fetchone())[0] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{}, {"direct_urls": [1]}, {"direct_urls": [" "]}])
async def test_direct_jobs_fail_invalid_inputs_with_existing_retry_state(test_db, payload) -> None:
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError
    from atlas.platform.database import db

    _run, job = await _enqueue(test_db)
    await test_db.execute(
        "UPDATE discovery_jobs SET execution_mode = 'direct_url', input_payload = ? WHERE id = ?",
        (db.encode_json(payload), job),
    )
    await test_db.commit()
    assert (
        await DiscoveryJobCRUD.claim_next(
            test_db, claimed_by="new", checkpointed=True, search_key_configured=False
        )
    ).id == job
    result = await advance_claimed_discovery_job(
        test_db, job_id=job, claimed_by="new", settings=_settings()
    )
    assert result.status == "retry"
    assert (await DiscoveryJobCRUD.get_by_id(test_db, job)).retry_count == 1
    with pytest.raises(CheckpointLeaseLostError):
        await advance_claimed_discovery_job(
            test_db, job_id="missing", claimed_by="new", settings=_settings()
        )


@pytest.mark.asyncio
async def test_monolithic_completed_job_cannot_fabricate_continuation_receipt(test_db) -> None:
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    _run, job = await _enqueue(test_db)
    await DiscoveryJobCRUD.complete(test_db, job)
    with pytest.raises(CheckpointLeaseLostError):
        await advance_claimed_discovery_job(
            test_db, job_id=job, claimed_by="legacy", settings=_settings()
        )


@pytest.mark.asyncio
async def test_cancellation_after_progress_commit_cannot_be_undone_by_yield(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import (
        CheckpointLeaseLostError,
        _Checkpoints,
    )

    _run, job = await _enqueue(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="turn", checkpointed=True)
    original = _Checkpoints.save

    async def cancel_after_save(self: object, key: str, value: object, adapter: object) -> None:
        await original(self, key, value, adapter)
        if key == "continuation" and value.phase == "registry":
            await DiscoveryJobCRUD.cancel(test_db, job)

    monkeypatch.setattr(_Checkpoints, "save", cancel_after_save)
    with pytest.raises(CheckpointLeaseLostError):
        await advance_claimed_discovery_job(
            test_db,
            job_id=job,
            claimed_by="turn",
            settings=_settings(discovery_max_queries_per_run=0),
        )
    assert (await DiscoveryJobCRUD.get_by_id(test_db, job)).status == "cancelled"


@pytest.mark.asyncio
async def test_provider_error_after_cancellation_cannot_overwrite_terminal_state(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    _run, job = await _enqueue(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="turn", checkpointed=True)

    async def cancel_then_fail(*_args: object) -> None:
        await DiscoveryJobCRUD.cancel(test_db, job)
        msg = "late provider failure"
        raise RuntimeError(msg)

    monkeypatch.setattr(web, "fetch_sources", cancel_then_fail)
    with pytest.raises(CheckpointLeaseLostError):
        await advance_claimed_discovery_job(
            test_db, job_id=job, claimed_by="turn", settings=_settings()
        )
    saved = await DiscoveryJobCRUD.get_by_id(test_db, job)
    assert saved.status == "cancelled"
    assert saved.retry_count == 0


@pytest.mark.asyncio
@pytest.mark.usefixtures("sqlite_only")
async def test_expired_sqlite_claim_cannot_steal_a_newly_renewed_owner(test_db, db_url) -> None:
    _run, job = await _enqueue(test_db)
    await DiscoveryJobCRUD.claim_next(test_db, claimed_by="expired", lease_seconds=-1)
    other = await get_db_connection(db_url)

    class InterleavedCursor:
        def __init__(self, cursor: object) -> None:
            self.cursor = cursor
            self.description = cursor.description

        async def fetchone(self) -> object:
            row = await self.cursor.fetchone()
            claimed = await DiscoveryJobCRUD.claim_next(
                other, claimed_by="winner", checkpointed=True
            )
            assert claimed.id == job
            return row

    class PausedClaim:
        commit = test_db.commit
        first = True

        async def execute(self, sql: str, parameters: object = ()) -> object:
            cursor = await test_db.execute(sql, parameters)
            if self.first:
                self.first = False
                return InterleavedCursor(cursor)
            return cursor

    try:
        assert (
            await DiscoveryJobCRUD.claim_next(
                PausedClaim(), claimed_by="stale-reader", checkpointed=True
            )
            is None
        )
        assert (await DiscoveryJobCRUD.get_by_id(test_db, job)).claimed_by == "winner"
    finally:
        await other.close()


@pytest.mark.asyncio
async def test_final_ack_loss_is_not_requeued_and_replays_terminal_receipt(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import continuation
    from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineCredentials
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    _run, job = await _enqueue(test_db)
    original = continuation.finalize_discovery_job

    async def lose_ack(*args: object, **kwargs: object) -> object:
        await original(*args, **kwargs)
        msg = "final acknowledgement lost"
        raise ConnectionError(msg)

    monkeypatch.setattr(continuation, "finalize_discovery_job", lose_ack)
    credentials = DiscoveryPipelineCredentials(
        "private-search-credential", "private-model-credential"
    )
    for index in range(15):
        owner = f"turn-{index}"
        await DiscoveryJobCRUD.claim_next(test_db, claimed_by=owner, checkpointed=True)
        try:
            await continuation.advance_claimed_discovery_job(
                test_db,
                job_id=job,
                claimed_by=owner,
                settings=_settings(discovery_max_queries_per_run=0),
                credentials=credentials,
            )
        except CheckpointLeaseLostError:
            break
    saved = await DiscoveryJobCRUD.get_by_id(test_db, job)
    assert saved.status == "completed"
    assert saved.retry_count == 0
    assert (
        await continuation.advance_claimed_discovery_job(
            test_db, job_id=job, claimed_by="recovery", settings=_settings()
        )
    ).status == "completed"
    cursor = await test_db.execute(
        "SELECT result FROM discovery_web_checkpoints WHERE job_id = ?", (job,)
    )
    for (value,) in await cursor.fetchall():
        assert "private-search-credential" not in value
        assert "private-model-credential" not in value


@pytest.mark.asyncio
async def test_direct_job_preserves_seed_evidence_without_search_or_registry(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline import continuation
    from atlas.domains.discovery.pipeline import web_checkpoints as web
    from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineCredentials
    from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
    from atlas.platform.database import db

    from .test_extraction_checkpoints import _client, _reply

    run, job = await _enqueue(test_db)
    await test_db.execute(
        "UPDATE discovery_jobs SET execution_mode = 'direct_url', input_payload = ? WHERE id = ?",
        (
            db.encode_json(
                {"direct_urls": [" https://example.org/story#top ", "https://example.org/story"]}
            ),
            job,
        ),
    )
    await test_db.commit()
    direct = AsyncMock(
        return_value=FetchedSource(
            "https://example.org/story", "Source", None, None, "Housing Trust helps", "report"
        )
    )
    search = AsyncMock(side_effect=AssertionError("direct work must not search"))
    registry = AsyncMock(side_effect=AssertionError("direct work must not broaden its scope"))
    monkeypatch.setattr(web, "fetch_direct_source", direct)
    monkeypatch.setattr(web, "fetch_sources", search)
    monkeypatch.setattr(continuation, "advance_registry_discovery", registry)
    request, _, _ = _client(
        monkeypatch,
        [
            _reply('[{"name":"Housing Trust"}]'),
            _reply('{"entries":[{"name":"Housing Trust","type":"organization"}]}'),
        ],
    )
    for index in range(12):
        owner = f"direct-{index}"
        claimed = await DiscoveryJobCRUD.claim_next(
            test_db, claimed_by=owner, checkpointed=True, search_key_configured=False
        )
        assert claimed.id == job
        result = await continuation.advance_claimed_discovery_job(
            test_db,
            job_id=job,
            claimed_by=owner,
            settings=_settings(),
            credentials=DiscoveryPipelineCredentials(anthropic_api_key="private"),
        )
        if result.status == "completed":
            break
        assert result.status == "yielded"
    assert result.status == "completed"
    assert direct.await_args.args == ("https://example.org/story",)
    assert direct.await_count == 1
    assert request.await_count == 2
    assert (await DiscoveryRunCRUD.get_by_id(test_db, run)).sources_processed == 1
    cursor = await test_db.execute("SELECT DISTINCT kind FROM cost_ledger WHERE run_id = ?", (run,))
    assert await cursor.fetchall() == [("llm",)]
    search.assert_not_awaited()
    registry.assert_not_awaited()


@pytest.mark.asyncio
async def test_evidence_only_empty_target_does_not_invent_searches(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import continuation
    from atlas.domains.discovery.pipeline import web_checkpoints as web

    run = await DiscoveryRunCRUD.create(test_db, location_query="", state="", issue_areas=[])
    job = await DiscoveryJobCRUD.create(test_db, run_id=run)
    search = AsyncMock(side_effect=AssertionError("empty targets must not search"))
    registry = AsyncMock(side_effect=AssertionError("empty targets must not broaden scope"))
    monkeypatch.setattr(web, "fetch_sources", search)
    monkeypatch.setattr(continuation, "advance_registry_discovery", registry)
    for index in range(6):
        owner = f"evidence-{index}"
        assert (
            await DiscoveryJobCRUD.claim_next(
                test_db, claimed_by=owner, checkpointed=True, search_key_configured=False
            )
        ).id == job
        result = await continuation.advance_claimed_discovery_job(
            test_db, job_id=job, claimed_by=owner, settings=_settings()
        )
        if result.status == "completed":
            break
        assert result.status == "yielded", (
            await DiscoveryJobCRUD.get_by_id(test_db, job)
        ).error_message
    assert result.status == "completed"
    assert (await DiscoveryRunCRUD.get_by_id(test_db, run)).entries_extracted == 0
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger WHERE run_id = ?", (run,))
    assert (await cursor.fetchone())[0] == 0
    search.assert_not_awaited()
    registry.assert_not_awaited()
