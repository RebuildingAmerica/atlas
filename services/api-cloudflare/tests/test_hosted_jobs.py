"""Alarms preserve the Firehose outbox across transaction and worker failures."""

import asyncio
import copy
import importlib
import importlib.util
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import aiosqlite
import pytest
import pytest_asyncio

from atlas.domains.firehose import delivery_worker
from atlas.domains.firehose.model_deliveries import FirehoseObservationDeliveryCRUD
from atlas.platform.hosted_runtime import HostedRuntime, current_hosted_runtime


def module():
    assert importlib.util.find_spec("hosted_jobs") is not None, (
        "Hosted jobs adapter is missing"
    )
    return importlib.import_module("hosted_jobs")


class Storage:
    def __init__(self):
        self.values = {}
        self.alarm_at = None

    async def get(self, key):
        return copy.deepcopy(self.values.get(key))

    async def put(self, key, value):
        self.values[key] = copy.deepcopy(value)

    async def getAlarm(self):
        return self.alarm_at

    async def deleteAlarm(self):
        self.alarm_at = None

    async def wake(self, at):
        self.alarm_at = at


@pytest_asyncio.fixture
async def outbox(tmp_path, monkeypatch):
    path = tmp_path / "outbox.db"
    setup = await aiosqlite.connect(path)
    await setup.execute(
        "CREATE TABLE firehose_observation_deliveries ("
        "id TEXT PRIMARY KEY, observation_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, "
        "attempts INTEGER NOT NULL, claimed_by TEXT, claimed_until TEXT, "
        "next_attempt_at TEXT NOT NULL, last_error TEXT, delivered_at TEXT, "
        "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    await setup.commit()
    now = datetime(2026, 10, 10, tzinfo=UTC)
    opened = []
    materialized = []

    async def connect(database_url, *, backend):
        assert database_url == "postgresql://test/atlas"
        assert backend == "postgres"
        conn = await aiosqlite.connect(path)
        opened.append(conn)
        return conn

    settings = SimpleNamespace(
        database_url="postgresql://test/atlas",
        database_backend="postgres",
        firehose_delivery_worker_lease_seconds=60,
    )
    runtime = HostedRuntime(settings=settings, connect=connect)

    async def materialize(conn, *, observation_id):
        assert current_hosted_runtime() is runtime
        materialized.append(observation_id)

    monkeypatch.setattr(delivery_worker, "create_signals_for_observation", materialize)
    storage = Storage()
    fixture = SimpleNamespace(
        conn=setup,
        runtime=runtime,
        storage=storage,
        now=now,
        materialized=materialized,
        opened=opened,
    )
    yield fixture
    await setup.close()
    for conn in opened:
        assert not conn._running, "Alarm leaked its owned database connection"


def adapter(outbox):
    return module().FirehoseAlarmAdapter(
        runtime=outbox.runtime,
        storage=outbox.storage,
        wake=outbox.storage.wake,
        clock=lambda: outbox.now,
    )


async def enqueue(outbox, observation_id, *, due=None):
    return await FirehoseObservationDeliveryCRUD.enqueue(
        outbox.conn,
        observation_id=observation_id,
        next_attempt_at=(due or outbox.now).isoformat(),
    )


async def fire(outbox, worker):
    # Cloudflare removes a fired alarm before invoking the handler.
    outbox.storage.alarm_at = None
    return await worker.alarm()


@pytest.mark.asyncio
async def test_one_delivery_per_alarm_then_no_idle_alarm(outbox):
    worker = adapter(outbox)
    await enqueue(outbox, "first")
    await enqueue(outbox, "second")
    await worker.confirm_wake()
    result = await fire(outbox, worker)
    assert (result.processed, result.delivered, result.failed) == (1, 1, 0)
    assert len(outbox.materialized) == 1
    assert outbox.storage.alarm_at == 1791590400001
    await fire(outbox, worker)
    assert sorted(outbox.materialized) == ["first", "second"]
    assert outbox.storage.alarm_at is None
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_precommit_wake_survives_restart_and_empty_first_alarm(outbox):
    worker = adapter(outbox)
    await worker.prepare_wake("committed-late")
    await fire(outbox, worker)
    assert outbox.storage.alarm_at > 1791590400000
    assert not outbox.materialized
    worker = adapter(outbox)  # New isolate restores the durable intent.
    await enqueue(outbox, "committed-late")
    await worker.confirm_wake("committed-late")
    await fire(outbox, worker)
    assert outbox.materialized == ["committed-late"]
    assert outbox.storage.alarm_at is None


@pytest.mark.asyncio
async def test_committed_observation_resolves_receipt_when_acknowledgement_is_lost(
    outbox,
):
    worker = adapter(outbox)
    await worker.prepare_wake("committed-without-acknowledgement")
    await fire(outbox, worker)
    await enqueue(outbox, "committed-without-acknowledgement")
    await fire(outbox, adapter(outbox))
    assert outbox.materialized == ["committed-without-acknowledgement"]
    assert outbox.storage.alarm_at is None


@pytest.mark.asyncio
async def test_rolled_back_intent_stops_without_idle_polling(outbox):
    worker = adapter(outbox)
    await worker.prepare_wake("rollback")
    await worker.abort_wake("rollback")
    await fire(outbox, worker)
    assert outbox.storage.alarm_at is None


@pytest.mark.asyncio
async def test_failed_delivery_uses_existing_backoff_and_recovers(outbox, monkeypatch):
    worker = adapter(outbox)
    delivery = await enqueue(outbox, "source-update")

    async def fail(conn, *, observation_id):
        raise ValueError("Temporary route failure")

    monkeypatch.setattr(delivery_worker, "create_signals_for_observation", fail)
    result = await fire(outbox, worker)
    assert (result.processed, result.failed) == (1, 1)
    row = await FirehoseObservationDeliveryCRUD.get_by_id(outbox.conn, delivery.id)
    assert (row.status, row.attempts, row.last_error) == (
        "failed",
        1,
        "Temporary route failure",
    )
    assert outbox.storage.alarm_at == 1791590460000
    monkeypatch.undo()
    outbox.now += timedelta(seconds=60)

    async def recovered(conn, *, observation_id):
        outbox.materialized.append(observation_id)

    monkeypatch.setattr(delivery_worker, "create_signals_for_observation", recovered)
    await fire(outbox, worker)
    row = await FirehoseObservationDeliveryCRUD.get_by_id(outbox.conn, delivery.id)
    assert (row.status, row.attempts) == ("delivered", 2)
    assert outbox.storage.alarm_at is None


@pytest.mark.asyncio
async def test_unexpired_lease_rearms_at_expiry_then_reclaims(outbox):
    worker = adapter(outbox)
    delivery = await enqueue(outbox, "interrupted")
    await FirehoseObservationDeliveryCRUD.claim_due(
        outbox.conn,
        worker_id="previous-isolate",
        now=outbox.now.isoformat(),
        lease_seconds=60,
        limit=1,
    )
    assert (await fire(outbox, worker)).processed == 0
    assert outbox.storage.alarm_at == 1791590460000
    outbox.now += timedelta(seconds=60)
    await fire(outbox, worker)
    row = await FirehoseObservationDeliveryCRUD.get_by_id(outbox.conn, delivery.id)
    assert (row.status, row.attempts) == ("delivered", 2)


@pytest.mark.asyncio
async def test_database_outage_keeps_rescue_alarm_beyond_provider_retry_budget(outbox):
    async def unavailable(*args, **kwargs):
        raise ConnectionError("Database unavailable")

    outbox.runtime = HostedRuntime(
        settings=outbox.runtime.settings, connect=unavailable
    )
    for _ in range(8):
        with pytest.raises(ConnectionError, match="Database unavailable"):
            await fire(outbox, adapter(outbox))
        assert outbox.storage.alarm_at == int(outbox.now.timestamp() * 1000) + 60000
        outbox.now += timedelta(minutes=1)


@pytest.mark.asyncio
async def test_wake_during_processing_cannot_be_erased_by_reconciliation(
    outbox, monkeypatch
):
    worker = adapter(outbox)
    await enqueue(outbox, "first")
    entered = asyncio.Event()
    released = asyncio.Event()

    async def paused(conn, *, observation_id):
        entered.set()
        await released.wait()

    monkeypatch.setattr(delivery_worker, "create_signals_for_observation", paused)
    running = asyncio.create_task(fire(outbox, worker))
    await entered.wait()
    await worker.confirm_wake()
    released.set()
    await running
    assert outbox.storage.alarm_at == 1791590400001
    await fire(outbox, worker)
    assert outbox.storage.alarm_at is None


@pytest.mark.asyncio
async def test_cancellation_leaves_recoverable_lease_and_alarm(outbox, monkeypatch):
    worker = adapter(outbox)
    delivery = await enqueue(outbox, "cancelled")
    entered = asyncio.Event()

    async def paused(conn, *, observation_id):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(delivery_worker, "create_signals_for_observation", paused)
    running = asyncio.create_task(fire(outbox, worker))
    await entered.wait()
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    row = await FirehoseObservationDeliveryCRUD.get_by_id(outbox.conn, delivery.id)
    assert row.status == "claimed"
    assert outbox.storage.alarm_at == 1791590460000
