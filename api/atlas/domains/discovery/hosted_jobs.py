"""Durable search-lane wakeups preserve queued research across host restarts."""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Protocol, cast
from uuid import uuid4

from pydantic import BaseModel, Field

from atlas.domains.discovery.models import DiscoveryJobCRUD
from atlas.domains.discovery.pipeline.continuation import advance_claimed_discovery_job
from atlas.domains.discovery.pipeline.runner import DiscoveryPipelineCredentials
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from aiosqlite import Connection

    from atlas.domains.discovery.pipeline.continuation import DiscoveryTurnResult
    from atlas.platform.hosted_runtime import FirehoseWake


class DiscoveryAlarmStorage(Protocol):  # pragma: no cover - binding interface
    """Release-gated Durable Object storage supplied by the production adapter."""

    async def get(self, key: str) -> object: ...
    async def put(self, key: str, value: object) -> None: ...
    async def getAlarm(self) -> int | None: ...  # noqa: N802 - provider API
    async def setAlarm(self, timestamp: int) -> None: ...  # noqa: N802 - provider API
    async def deleteAlarm(self) -> None: ...  # noqa: N802 - provider API


class _WakeState(BaseModel):
    generation: int = Field(default=0, ge=0, strict=True)
    pending: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(
        default_factory=list, max_length=64
    )
    checks: int = Field(default=0, ge=0, le=6, strict=True)


class _DeferredFirehoseWake:
    """Do not confirm observations until their enclosing publication commits."""

    def __init__(self, wake: FirehoseWake) -> None:
        self.wake = wake
        self.confirmations: set[str | None] = set()

    async def prepare_wake(self, receipt: str) -> None:
        self.confirmations.add(receipt)
        await self.wake.prepare_wake(receipt)

    async def confirm_wake(self, receipt: str | None = None) -> None:
        # Publication deliberately suppresses helper commits. The real commit
        # happens before the continuation returns, not at this nested callback.
        self.confirmations.add(receipt)

    async def abort_wake(self, receipt: str) -> None:
        await self.wake.abort_wake(receipt)
        self.confirmations.discard(receipt)

    async def flush(self) -> None:
        for receipt in self.confirmations:
            await self.wake.confirm_wake(receipt)
        self.confirmations.clear()


@asynccontextmanager
async def _owned_resources(wake: _DeferredFirehoseWake | None) -> AsyncIterator[AsyncExitStack]:
    resources = AsyncExitStack()

    async def finish() -> None:
        # Once every connection has closed, no uncommitted transaction can
        # become visible later. Confirming now wakes committed outboxes and
        # clears proven-ended receipts even after cancellation or rollback.
        # A failed close retains receipts rather than guessing the outcome.
        await resources.aclose()
        if wake is not None:
            await wake.flush()

    try:
        yield resources
    except BaseException as work_error:
        try:
            await finish()
        except BaseException as cleanup_error:
            raise work_error from cleanup_error
        raise
    else:
        await finish()


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _epoch_ms(value: datetime) -> int:
    if value.tzinfo is None:
        raise ValueError("Discovery alarm clock must include a timezone")  # noqa: TRY003
    return int(value.timestamp() * 1000)


class DiscoveryAlarmAdapter:
    """Run one search job turn per alarm, with durable precommit wake receipts.

    Parameters
    ----------
    runtime
        Explicit provider configuration and invocation-owned connection factory.
    storage
        Release-gated storage. Paused consumers retain receipts without alarms.
    clock
        UTC clock for initial, rescue and next-due alarms. No process loop starts.
    """

    _STATE_KEY = "atlas:discovery:wake:v1"
    _LEASE_SECONDS = 900
    _MAX_RECEIPT_LENGTH = 128
    _MAX_PENDING = 64

    def __init__(
        self,
        *,
        runtime: HostedRuntime,
        storage: DiscoveryAlarmStorage,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        if runtime.settings.database_backend != "postgres":
            raise ValueError("Hosted discovery requires PostgreSQL")  # noqa: TRY003
        self.runtime = runtime
        self.storage = storage
        self.clock = clock
        self._gate = asyncio.Lock()

    async def _state(self) -> _WakeState:
        value = await self.storage.get(self._STATE_KEY)
        return _WakeState() if value is None else _WakeState.model_validate(value)

    async def _soon(self) -> None:
        due = _epoch_ms(self.clock()) + 1
        existing = await self.storage.getAlarm()
        if existing is None or existing > due:
            await self.storage.setAlarm(due)

    async def prepare_wake(self, receipt: str) -> None:
        """Retain the job ID and arm recovery before its queue insert commits."""
        if not receipt or len(receipt) > self._MAX_RECEIPT_LENGTH:
            raise ValueError("Wake receipt must contain 1 to 128 characters")  # noqa: TRY003
        async with self._gate:
            state = await self._state()
            if receipt not in state.pending:
                if len(state.pending) == self._MAX_PENDING:
                    raise RuntimeError("Too many unacknowledged discovery transactions")  # noqa: TRY003
                state.pending.append(receipt)
            await self._soon()
            state.generation += 1
            state.checks = 0
            await self.storage.put(self._STATE_KEY, state.model_dump())

    async def confirm_wake(self, receipt: str | None = None) -> None:
        """Wake committed work; initial enable also reconciles preexisting jobs."""
        async with self._gate:
            state = await self._state()
            await self._soon()
            if receipt in state.pending:
                state.pending.remove(receipt)
            state.generation += 1
            state.checks = 0
            await self.storage.put(self._STATE_KEY, state.model_dump())

    async def abort_wake(self, receipt: str) -> None:
        """Clear a proven rollback; ambiguous commit receipts remain retained."""
        await self.confirm_wake(receipt)

    async def alarm(self) -> DiscoveryTurnResult | None:
        """Run at most one search continuation, always closing alarm resources."""
        async with self._gate:
            await self.storage.setAlarm(_epoch_ms(self.clock()) + 60_000)
            generation = (await self._state()).generation
        settings = self.runtime.settings
        deferred = (
            _DeferredFirehoseWake(self.runtime.firehose_wake)
            if self.runtime.firehose_wake is not None
            else None
        )
        async with _owned_resources(deferred) as resources:

            async def connect(database_url: str, *, backend: str | None = None) -> Connection:
                connection = await self.runtime.connect(database_url, backend=backend)
                resources.push_async_callback(connection.close)
                return cast("Connection", connection)

            runtime = replace(
                self.runtime, connect=connect, discovery_wake=self, firehose_wake=deferred
            )
            with bind_hosted_runtime(runtime):
                connection = await connect(settings.database_url, backend=settings.database_backend)
                # Only this hosted lane is reaped; Scout jobs retain their owner.
                await DiscoveryJobCRUD.reap_orphans(connection, execution_mode="search", limit=1)
                owner = f"discovery-alarm-{uuid4().hex}"
                job = await DiscoveryJobCRUD.claim_next(
                    connection,
                    claimed_by=owner,
                    lease_seconds=self._LEASE_SECONDS,
                    checkpointed=True,
                    execution_mode="search",
                    search_key_configured=bool(settings.search_api_key),
                )
                result = None
                if job is not None:
                    result = await advance_claimed_discovery_job(
                        connection,
                        job_id=job.id,
                        claimed_by=owner,
                        settings=settings,
                        credentials=DiscoveryPipelineCredentials(
                            search_api_key=settings.search_api_key,
                            anthropic_api_key=settings.anthropic_api_key,
                        ),
                    )
                await self._schedule(connection, generation)
                return result

    async def _schedule(self, connection: Connection, generation: int) -> None:
        async with self._gate:
            state = await self._state()
            if state.pending:
                placeholders = ", ".join("?" for _ in state.pending)
                cursor = await connection.execute(
                    f"SELECT id FROM discovery_jobs WHERE id IN ({placeholders}) AND execution_mode = 'search'",
                    tuple(state.pending),
                )
                committed = {str(row[0]) for row in await cursor.fetchall()}
                state.pending = [receipt for receipt in state.pending if receipt not in committed]
            capability = (
                ""
                if self.runtime.settings.search_api_key
                else ("AND COALESCE(r.location_query, '') = '' AND r.issue_areas = '[]'")
            )
            now = self.clock()
            cursor = await connection.execute(
                "SELECT MIN(CASE WHEN j.status IN ('claimed', 'running') THEN j.claimed_until "
                "ELSE COALESCE(j.next_attempt_at, ?) END) FROM discovery_jobs j "
                "JOIN discovery_runs r ON r.id = j.run_id "
                "WHERE j.execution_mode = 'search' AND j.status IN ('queued', 'claimed', 'running') "
                f"{capability}",
                (now.isoformat(),),
            )
            row = await cursor.fetchone()
            now_ms = _epoch_ms(now)
            candidates = []
            if row is not None and row[0] is not None:
                due = datetime.fromisoformat(str(row[0]).replace("Z", "+00:00"))
                candidates.append(max(now_ms + 1, _epoch_ms(due)))
            if state.generation != generation:
                candidates.append(now_ms + 1)
            if state.pending:
                state.checks = min(state.checks + 1, 6)
                candidates.append(now_ms + min(1000 * 2**state.checks, 60_000))
            await self.storage.put(self._STATE_KEY, state.model_dump())
            if candidates:
                await self.storage.setAlarm(min(candidates))
            else:
                await self.storage.deleteAlarm()
