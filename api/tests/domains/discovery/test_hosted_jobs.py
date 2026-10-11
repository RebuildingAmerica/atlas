"""Durable alarms own only hosted search jobs and retain precommit wakeups."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from psycopg import OperationalError

from atlas.domains.discovery import hosted_jobs as hosted
from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings
from atlas.platform.database import get_db_connection
from atlas.platform.hosted_runtime import HostedRuntime, current_hosted_runtime


class Storage:
    def __init__(self) -> None:
        self.values = {}
        self.at = None
        self.history = []

    async def get(self, key) -> object:
        return deepcopy(self.values.get(key))

    async def put(self, key, value) -> None:
        self.values[key] = deepcopy(value)

    async def getAlarm(self) -> int | None:  # noqa: N802 - provider interface
        return self.at

    async def setAlarm(self, at) -> None:  # noqa: N802 - provider interface
        self.at = at
        self.history.append(at)

    async def deleteAlarm(self) -> None:  # noqa: N802 - provider interface
        self.at = None


async def _adapter(
    db_url, *, storage=None, clock=None, settings=None, firehose=None
) -> tuple[hosted.DiscoveryAlarmAdapter, object]:
    settings = settings or Settings(
        _env_file=None,
        database_backend="postgres",
        database_url="postgresql://test/atlas",
        search_api_key="search-private",
        anthropic_api_key="model-private",
    ).model_copy(
        update={"discovery_max_queries_per_run": 0, "discovery_registry_max_organizations": 0}
    )
    connection = await get_db_connection(db_url)
    connect = AsyncMock(return_value=connection)
    adapter = hosted.DiscoveryAlarmAdapter(
        runtime=HostedRuntime(settings, connect, firehose_wake=firehose),
        storage=storage or Storage(),
        clock=clock or (lambda: datetime.now(UTC)),
    )
    return adapter, connection


async def _job(conn, *, mode="search") -> tuple[str, str]:
    run = await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )
    job = await DiscoveryJobCRUD.create(conn, run_id=run, job_input=DiscoveryJobInput(mode))
    return run, job


@pytest.mark.asyncio
async def test_fresh_alarm_consumes_existing_search_and_never_enrolls_scout(
    test_db, db_url
) -> None:
    _, direct = await _job(test_db, mode="direct_url")
    run, search = await _job(test_db)
    storage = Storage()
    opened = []
    for _ in range(10):
        adapter, connection = await _adapter(db_url, storage=storage)
        opened.append(connection)
        result = await adapter.alarm()
        assert current_hosted_runtime() is None
        assert (await DiscoveryJobCRUD.get_by_id(test_db, direct)).status == "queued"
        if result.status == "completed":
            break
        assert result.status == "yielded"
        assert storage.at is not None
    assert result.status == "completed"
    assert (await DiscoveryRunCRUD.get_by_id(test_db, run)).status == "completed"
    assert storage.at is None
    cursor = await test_db.execute("SELECT DISTINCT job_id FROM discovery_web_checkpoints")
    assert await cursor.fetchall() == [(search,)]
    for connection in opened:
        with pytest.raises((ValueError, OperationalError), match=r"closed|no active"):
            await connection.execute("SELECT 1")
    assert all("private" not in str(value) for value in storage.values.values())


@pytest.mark.asyncio
async def test_next_retry_and_lease_are_scheduled_without_idle_polling(test_db, db_url) -> None:
    now = datetime.now(UTC)
    _, retry = await _job(test_db)
    _, leased = await _job(test_db)
    await test_db.execute(
        "UPDATE discovery_jobs SET next_attempt_at = ? WHERE id = ?",
        ((now + timedelta(minutes=2)).isoformat(), retry),
    )
    await test_db.execute(
        "UPDATE discovery_jobs SET status = 'running', claimed_by = 'other', claimed_until = ? WHERE id = ?",
        ((now + timedelta(minutes=1)).isoformat(), leased),
    )
    await test_db.commit()
    storage = Storage()
    adapter, _ = await _adapter(db_url, storage=storage, clock=lambda: now)
    assert await adapter.alarm() is None
    assert storage.at == int((now + timedelta(minutes=1)).timestamp() * 1000)
    await DiscoveryJobCRUD.cancel(test_db, leased)
    adapter, _ = await _adapter(db_url, storage=storage, clock=lambda: now)
    assert await adapter.alarm() is None
    assert storage.at == int((now + timedelta(minutes=2)).timestamp() * 1000)
    await DiscoveryJobCRUD.cancel(test_db, retry)
    adapter, _ = await _adapter(db_url, storage=storage)
    assert await adapter.alarm() is None
    assert storage.at is None


@pytest.mark.asyncio
async def test_reaping_is_bounded_and_does_not_revoke_scout(test_db, db_url) -> None:
    _, direct = await _job(test_db, mode="direct_url")
    _, search = await _job(test_db)
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    await test_db.execute(
        "UPDATE discovery_jobs SET status = 'running', claimed_by = 'old', claimed_until = ?",
        (past,),
    )
    await test_db.commit()
    adapter, _ = await _adapter(db_url)
    assert (await adapter.alarm()).status == "yielded"
    assert (await DiscoveryJobCRUD.get_by_id(test_db, direct)).status == "running"
    job = await DiscoveryJobCRUD.get_by_id(test_db, search)
    assert job.retry_count == 1
    assert job.status == "queued"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["connect", "turn", "cancel"])
async def test_rescue_is_armed_before_io_and_resources_close(db_url, monkeypatch, failure) -> None:
    adapter, connection = await _adapter(db_url)
    storage = adapter.storage
    if failure == "connect":
        adapter.runtime = replace(
            adapter.runtime, connect=AsyncMock(side_effect=ConnectionError("offline"))
        )
        await connection.close()
    else:
        monkeypatch.setattr(
            DiscoveryJobCRUD, "claim_next", AsyncMock(return_value=SimpleNamespace(id="job"))
        )

        async def fail(*_args: object, **_kwargs: object) -> None:
            assert storage.at is not None
            assert current_hosted_runtime().discovery_wake is adapter
            if failure == "cancel":
                raise asyncio.CancelledError
            raise ConnectionError("interrupted")

        monkeypatch.setattr(hosted, "advance_claimed_discovery_job", fail)
    with pytest.raises(asyncio.CancelledError if failure == "cancel" else ConnectionError):
        await adapter.alarm()
    assert storage.at is not None
    assert current_hosted_runtime() is None
    with pytest.raises((ValueError, OperationalError), match=r"closed|no active"):
        await connection.execute("SELECT 1")


@pytest.mark.asyncio
async def test_precommit_receipts_survive_restart_until_commit_or_explicit_abort(
    test_db, db_url
) -> None:
    adapter, connection = await _adapter(db_url)
    await connection.close()
    storage = adapter.storage
    await adapter.prepare_wake("pending")
    await adapter.prepare_wake("pending")
    assert (await adapter._state()).pending == ["pending"]
    for _ in range(8):
        adapter, _ = await _adapter(db_url, storage=storage)
        assert await adapter.alarm() is None
        assert storage.at is not None
    assert (await adapter._state()).checks == 6
    await adapter.abort_wake("pending")
    adapter, _ = await _adapter(db_url, storage=storage)
    assert await adapter.alarm() is None
    assert storage.at is None
    _, job = await _job(test_db)
    await adapter.prepare_wake(job)
    adapter, _ = await _adapter(db_url, storage=storage)
    await adapter.alarm()
    assert (await adapter._state()).pending == []


@pytest.mark.asyncio
async def test_wake_during_alarm_preserves_generation_and_deferred_firehose(
    test_db, db_url, monkeypatch
) -> None:
    firehose = SimpleNamespace(
        prepare_wake=AsyncMock(), confirm_wake=AsyncMock(), abort_wake=AsyncMock()
    )
    adapter, _ = await _adapter(db_url, firehose=firehose)
    _, job = await _job(test_db)

    async def turn(conn, **kwargs: object) -> None:
        assert kwargs["credentials"].search_api_key == "search-private"
        wake = current_hosted_runtime().firehose_wake
        await wake.prepare_wake("observation")
        await wake.confirm_wake("observation")
        firehose.confirm_wake.assert_not_awaited()
        await wake.prepare_wake("rolled-back")
        await wake.confirm_wake("rolled-back")
        await wake.abort_wake("rolled-back")
        await adapter.confirm_wake()
        await DiscoveryJobCRUD.cancel(conn, job)

    monkeypatch.setattr(hosted, "advance_claimed_discovery_job", turn)
    assert await adapter.alarm() is None
    firehose.confirm_wake.assert_awaited_once_with("observation")
    firehose.abort_wake.assert_awaited_once_with("rolled-back")
    assert adapter.storage.at is not None


@pytest.mark.asyncio
async def test_missing_search_key_does_not_hot_loop_incapable_work(test_db, db_url) -> None:
    await _job(test_db)
    settings = Settings(
        _env_file=None,
        database_backend="postgres",
        database_url="postgresql://test/atlas",
        search_api_key=None,
    )
    adapter, _ = await _adapter(db_url, settings=settings)
    assert await adapter.alarm() is None
    assert adapter.storage.at is None


@pytest.mark.asyncio
async def test_receipt_validation_preserves_existing_alarm(db_url) -> None:
    adapter, conn = await _adapter(db_url)
    await conn.close()
    for receipt in ["", "x" * 129]:
        with pytest.raises(ValueError, match="receipt"):
            await adapter.prepare_wake(receipt)
    for index in range(64):
        await adapter.prepare_wake(str(index))
    with pytest.raises(RuntimeError, match="Too many"):
        await adapter.prepare_wake("overflow")
    adapter.storage.values[adapter._STATE_KEY] = {"generation": "invalid"}
    with pytest.raises(ValueError, match="generation"):
        await adapter.confirm_wake()
    with pytest.raises(ValueError, match="timezone"):
        hosted._epoch_ms(datetime(2026, 1, 1))  # noqa: DTZ001 - reject naive clocks
    with pytest.raises(ValueError, match="PostgreSQL"):
        hosted.DiscoveryAlarmAdapter(
            runtime=replace(
                adapter.runtime,
                settings=Settings(
                    _env_file=None, database_backend="sqlite", database_url="sqlite:///test.db"
                ),
            ),
            storage=adapter.storage,
        )
    assert hosted._utc_now().tzinfo is UTC


@pytest.mark.asyncio
@pytest.mark.parametrize("cleanup_fails", [False, True])
async def test_interrupted_publication_confirms_only_after_connections_close(cleanup_fails) -> None:
    events = []
    wake = SimpleNamespace(
        prepare_wake=AsyncMock(), confirm_wake=AsyncMock(), abort_wake=AsyncMock()
    )
    deferred = hosted._DeferredFirehoseWake(wake)

    async def close() -> None:
        events.append("close")
        if cleanup_fails:
            message = "connection close uncertain"
            raise ConnectionError(message)

    async def confirm(_receipt) -> None:
        assert events == ["close"]
        events.append("confirm")

    wake.confirm_wake.side_effect = confirm

    async def interrupt() -> None:
        async with hosted._owned_resources(deferred) as resources:
            resources.push_async_callback(close)
            await deferred.prepare_wake("observation")
            # Cancellation before the nested producer can confirm must still
            # release its wake only after no SQL transaction can commit later.
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError) as raised:
        await interrupt()
    if cleanup_fails:
        wake.confirm_wake.assert_not_awaited()
        assert isinstance(raised.value.__cause__, ConnectionError)
    else:
        wake.confirm_wake.assert_awaited_once_with("observation")
