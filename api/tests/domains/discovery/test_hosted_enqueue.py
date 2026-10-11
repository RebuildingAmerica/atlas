"""Search jobs cannot commit before their durable consumer retains a wake."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryJobInput
from atlas.models import DiscoveryRunCRUD
from atlas.platform.config import Settings
from atlas.platform.database import get_db_connection
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime


class FailingConnection:
    def __init__(self, connection, failure) -> None:
        self.connection = connection
        self.failure = failure

    def __getattr__(self, name) -> object:
        return getattr(self.connection, name)

    async def execute(self, statement, parameters=()) -> object:
        if self.failure == "insert" and "INSERT INTO discovery_jobs" in statement:
            message = "insert failed"
            raise ConnectionError(message)
        return await self.connection.execute(statement, parameters)

    async def commit(self) -> None:
        await self.connection.commit()
        if self.failure == "commit":
            message = "commit acknowledgement lost"
            raise ConnectionError(message)


async def _run(conn) -> str:
    return await DiscoveryRunCRUD.create(
        conn, location_query="Las Vegas, NV", state="NV", issue_areas=["housing_affordability"]
    )


def _runtime(wake=None) -> HostedRuntime:
    return HostedRuntime(Settings(_env_file=None), AsyncMock(), discovery_wake=wake)


def _wake() -> SimpleNamespace:
    return SimpleNamespace(
        prepare_wake=AsyncMock(), confirm_wake=AsyncMock(), abort_wake=AsyncMock()
    )


@pytest.mark.asyncio
async def test_prepare_precedes_visibility_confirm_follows_commit(test_db, db_url) -> None:
    run = await _run(test_db)
    other = await get_db_connection(db_url)
    wake = _wake()

    async def prepare(receipt) -> None:
        assert await DiscoveryJobCRUD.get_by_id(other, receipt) is None

    async def confirm(receipt) -> None:
        assert (await DiscoveryJobCRUD.get_by_id(other, receipt)).run_id == run

    wake.prepare_wake.side_effect = prepare
    wake.confirm_wake.side_effect = confirm
    try:
        with bind_hosted_runtime(_runtime(wake)):
            job = await DiscoveryJobCRUD.create(test_db, run_id=run, idempotency_key="once")
            assert await DiscoveryJobCRUD.create(test_db, run_id=run, idempotency_key="once") == job
        wake.prepare_wake.assert_awaited_once_with(job)
        wake.confirm_wake.assert_awaited_once_with(job)
        wake.abort_wake.assert_not_awaited()
    finally:
        await other.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["prepare", "insert", "commit", "confirm"])
async def test_receipt_is_aborted_only_before_an_attempted_commit(test_db, failure) -> None:
    run = await _run(test_db)
    wake = _wake()
    if failure == "prepare":
        wake.prepare_wake.side_effect = ConnectionError("prepare failed")
    if failure == "confirm":
        wake.confirm_wake.side_effect = ConnectionError("confirm failed")
    with bind_hosted_runtime(_runtime(wake)), pytest.raises(ConnectionError):
        await DiscoveryJobCRUD.create(FailingConnection(test_db, failure), run_id=run)
    job = await DiscoveryJobCRUD.get_by_run_id(test_db, run)
    assert (job is not None) == (failure in {"commit", "confirm"})
    if failure in {"prepare", "insert"}:
        wake.abort_wake.assert_awaited_once_with(wake.prepare_wake.await_args.args[0])
    else:
        wake.abort_wake.assert_not_awaited()


@pytest.mark.asyncio
async def test_hosted_search_requires_wake_but_scout_and_node_remain_available(test_db) -> None:
    run = await _run(test_db)
    with bind_hosted_runtime(_runtime()):
        with pytest.raises(RuntimeError, match="wake"):
            await DiscoveryJobCRUD.create(test_db, run_id=run)
        direct = await DiscoveryJobCRUD.create(
            test_db, run_id=run, job_input=DiscoveryJobInput("direct_url")
        )
    assert (await DiscoveryJobCRUD.get_by_id(test_db, direct)).execution_mode == "direct_url"
    wake = _wake()
    with bind_hosted_runtime(_runtime(wake)):
        await DiscoveryJobCRUD.create(
            test_db, run_id=run, job_input=DiscoveryJobInput("direct_url")
        )
    wake.prepare_wake.assert_not_awaited()
    node = await DiscoveryJobCRUD.create(test_db, run_id=run)
    assert (await DiscoveryJobCRUD.get_by_id(test_db, node)).execution_mode == "search"
