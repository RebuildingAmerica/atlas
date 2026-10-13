"""Wake the Firehose outbox without keeping a Python worker loop alive.

Organization inboxes must retain source updates through isolate eviction and
temporary database failures. PostgreSQL remains the delivery/lease authority;
Durable Object storage retains only wake generations and producer receipts.

One alarm claims at most one delivery. This bounds cardinality, not arbitrary
materializer CPU: production-data CPU validation is still required, especially
for the existing watch-event history scan. Discovery's full pipeline is not
invoked here: its in-memory stages and partial commits are not resumable and
can exceed the Durable Object alarm's 15-minute wall-time limit.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, cast
from uuid import uuid4

from atlas.domains.firehose.delivery_worker import process_due_observation_deliveries
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from atlas.domains.firehose.delivery_worker import FirehoseDeliveryProcessingResult


class AlarmStorage(Protocol):
    """The Python Workers SDK's DurableObjectStorage binding surface."""

    async def get(self, key: str) -> object: ...

    async def put(self, key: str, value: object) -> None: ...

    async def getAlarm(self) -> int | None: ...

    async def deleteAlarm(self) -> None: ...


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _epoch_ms(value: datetime) -> int:
    if value.tzinfo is None:
        raise ValueError("Alarm timestamps must include a timezone")
    return int(value.timestamp() * 1000)


class FirehoseAlarmAdapter:
    """Own one adapter per Durable Object; delegate its alarm() method here.

    Parameters
    ----------
    runtime
        Explicit settings and a connector opening an alarm-owned connection.
    storage
        SQLite-backed Durable Object storage, with get/put and alarm methods.
    wake
        Async callback implementing ``await ctx.storage.setAlarm(epoch_ms)``.
    clock
        UTC clock; no timer, background task, or polling loop is allocated.

    Notes
    -----
    Producers whose enqueue already commits call ``confirm_wake()`` afterward.
    To wake before commit, await ``prepare_wake(observation_id)`` first and then
    confirm that receipt after commit, or abort it after rollback. The alarm
    also resolves receipts whose delivery is visible in PostgreSQL, covering
    lost postcommit acknowledgements. A pending receipt is never expired
    silently: a slow commit cannot be distinguished safely from an abandoned
    producer. Recovery must explicitly abort abandoned, rolled-back receipts.
    PostgreSQL and DO writes are not a distributed atomic transaction; producer
    integration must await preparation before committing the enqueue.
    """

    _STATE_KEY = "atlas:firehose:wake:v1"
    _MAX_PENDING_RECEIPTS = 64

    def __init__(
        self,
        *,
        runtime: HostedRuntime,
        storage: AlarmStorage,
        wake: Callable[[int], Awaitable[None]],
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        if runtime.settings.database_backend != "postgres":
            raise ValueError("Hosted deliveries require PostgreSQL")
        if runtime.settings.firehose_delivery_worker_lease_seconds <= 0:
            raise ValueError("Delivery lease must be positive")
        self.runtime = runtime
        self.storage = storage
        self.wake = wake
        self.clock = clock
        # A DO owns exactly one adapter. This gate covers state reconciliation,
        # never the delivery's external work; wake requests remain responsive.
        self._gate = asyncio.Lock()

    async def _state(self) -> dict:
        value = await self.storage.get(self._STATE_KEY)
        if value is None:
            return {"generation": 0, "pending": [], "checks": 0}
        if (
            not isinstance(value, dict)
            or type(value.get("generation")) is not int
            or type(value.get("checks")) is not int
            or not isinstance(value.get("pending"), list)
            or len(value["pending"]) > self._MAX_PENDING_RECEIPTS
            or any(not isinstance(receipt, str) for receipt in value["pending"])
        ):
            raise RuntimeError("Invalid durable Firehose wake state")
        return cast("dict", value)

    async def _soon(self) -> None:
        due = _epoch_ms(self.clock()) + 1
        existing = await self.storage.getAlarm()
        if existing is None or existing > due:
            # Arm before writing state, so an interruption cannot retain a
            # receipt without any alarm to reconcile it.
            await self.wake(due)

    async def prepare_wake(self, receipt: str) -> None:
        """Retain the observation ID before its enqueue transaction commits."""
        if not receipt or len(receipt) > 128:
            raise ValueError("Wake receipt must contain 1 to 128 characters")
        async with self._gate:
            state = await self._state()
            if receipt not in state["pending"]:
                if len(state["pending"]) >= self._MAX_PENDING_RECEIPTS:
                    raise RuntimeError(
                        "Too many unacknowledged Firehose enqueue transactions"
                    )
                state["pending"].append(receipt)
            await self._soon()
            state["generation"] += 1
            state["checks"] = 0
            await self.storage.put(self._STATE_KEY, state)

    async def confirm_wake(self, receipt: str | None = None) -> None:
        """Wake after a committed enqueue, optionally acknowledging its receipt."""
        async with self._gate:
            state = await self._state()
            await self._soon()
            if receipt in state["pending"]:
                state["pending"].remove(receipt)
            state["generation"] += 1
            state["checks"] = 0
            await self.storage.put(self._STATE_KEY, state)

    async def abort_wake(self, receipt: str) -> None:
        """Acknowledge rollback; the next reconciliation can stop its alarm."""
        await self.confirm_wake(receipt)

    async def alarm(self) -> FirehoseDeliveryProcessingResult:
        """Process one delivery, retaining a rescue alarm before database I/O."""
        async with self._gate:
            now_ms = _epoch_ms(self.clock())
            # Explicit rearming survives outages beyond CF's six automatic
            # retries and isolate termination while a PostgreSQL lease is held.
            await self.wake(now_ms + 60_000)
            generation = (await self._state())["generation"]

        connection = None
        try:
            with bind_hosted_runtime(self.runtime):
                settings = self.runtime.settings
                connection = await self.runtime.connect(
                    settings.database_url, backend=settings.database_backend
                )
                result = await process_due_observation_deliveries(
                    connection,
                    worker_id=f"firehose-alarm-{uuid4().hex}",
                    now=self.clock().isoformat(),
                    lease_seconds=settings.firehose_delivery_worker_lease_seconds,
                    limit=1,
                )
                async with self._gate:
                    state = await self._state()
                    state_changed = False
                    if state["pending"]:
                        placeholders = ", ".join("?" for _ in state["pending"])
                        cursor = await connection.execute(
                            "SELECT observation_id FROM firehose_observation_deliveries "
                            f"WHERE observation_id IN ({placeholders})",
                            tuple(state["pending"]),
                        )
                        committed = {str(row[0]) for row in await cursor.fetchall()}
                        if committed:
                            state["pending"] = [
                                receipt
                                for receipt in state["pending"]
                                if receipt not in committed
                            ]
                            state_changed = True
                    cursor = await connection.execute(
                        "SELECT MIN(CASE WHEN status = 'claimed' THEN claimed_until "
                        "ELSE next_attempt_at END) FROM firehose_observation_deliveries "
                        "WHERE status IN ('pending', 'failed', 'claimed')"
                    )
                    row = await cursor.fetchone()
                    await connection.close()
                    connection = None
                    now_ms = _epoch_ms(self.clock())
                    candidates = []
                    if row is not None and row[0] is not None:
                        due = datetime.fromisoformat(str(row[0]).replace("Z", "+00:00"))
                        candidates.append(max(now_ms + 1, _epoch_ms(due)))
                    if state["generation"] != generation:
                        candidates.append(now_ms + 1)
                    if state["pending"]:
                        state["checks"] = min(state["checks"] + 1, 6)
                        candidates.append(
                            now_ms + min(1000 * 2 ** state["checks"], 60_000)
                        )
                        state_changed = True
                    if state_changed:
                        await self.storage.put(self._STATE_KEY, state)
                    if candidates:
                        await self.wake(min(candidates))
                    else:
                        await self.storage.deleteAlarm()
                return result
        finally:
            if connection is not None:
                await connection.close()


def create_firehose_alarm(env, storage):
    """Build one instance-owned alarm with explicit Hyperdrive configuration.

    Connections belong to individual alarms and are closed by the adapter.
    Constructing the adapter performs no SQL, schema changes, or background work.
    """
    from hosted_application import _hyperdrive_parameters, _settings, connect_database
    from dns_transport import workers_dns_txt_lookup
    from http_transport import workers_http_transport_factory

    try:
        settings = _settings(env)
        transport_factory = workers_http_transport_factory(env)
        _hyperdrive_parameters(env)
    except Exception:
        raise RuntimeError("Invalid hosted API configuration.") from None

    async def connect(database_url, *, backend=None):
        if database_url != settings.database_url or backend not in (None, "postgres"):
            raise RuntimeError("Hosted database configuration mismatch.")
        return await connect_database(**_hyperdrive_parameters(env))

    adapter = FirehoseAlarmAdapter(
        runtime=HostedRuntime(
            settings,
            connect,
            dns_txt_lookup=workers_dns_txt_lookup,
            http_transport_factory=transport_factory,
        ),
        storage=storage,
        wake=storage.setAlarm,
    )
    # Materialization can itself produce observations. Those transactions use
    # this object's wake receipts just like HTTP producers do.
    adapter.runtime = replace(adapter.runtime, firehose_wake=adapter)
    return adapter
