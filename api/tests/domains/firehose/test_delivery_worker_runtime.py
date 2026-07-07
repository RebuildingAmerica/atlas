"""Firehose delivery worker runtime tests."""

from __future__ import annotations

import asyncio
import tempfile
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio

from atlas.config import Settings
from atlas.domains.firehose import delivery_worker
from atlas.domains.firehose.delivery_worker import start_delivery_worker, stop_delivery_worker
from atlas.main import lifespan
from atlas.models import init_db

DEFAULT_POLL_SECONDS = 10
DEFAULT_BATCH_SIZE = 25
DEFAULT_LEASE_SECONDS = 60
DATABASE_UNAVAILABLE_MESSAGE = "database unavailable"

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class _FakeConnection:
    """Minimal connection used to stop the worker loop deterministically."""

    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def _patch_mcp_session_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use a fresh no-op MCP session manager for direct lifespan tests."""

    @asynccontextmanager
    async def run() -> AsyncIterator[None]:
        yield

    session_manager = MagicMock()
    session_manager.run = run
    mcp = MagicMock()
    mcp.session_manager = session_manager
    monkeypatch.setattr("atlas.main.get_mcp", lambda: mcp)


@pytest_asyncio.fixture
async def db_url() -> str:
    """Create a temporary test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        url = f"sqlite:///{f.name}"
    await init_db(url)
    return url


def test_firehose_delivery_worker_is_disabled_by_default() -> None:
    """The hot delivery loop should be opt-in until production targets exist."""
    settings = Settings(database_url="sqlite:///tmp/test.db")

    assert settings.firehose_delivery_worker_enabled is False
    assert settings.firehose_delivery_worker_poll_seconds == DEFAULT_POLL_SECONDS
    assert settings.firehose_delivery_worker_batch_size == DEFAULT_BATCH_SIZE
    assert settings.firehose_delivery_worker_lease_seconds == DEFAULT_LEASE_SECONDS


@pytest.mark.asyncio
async def test_delivery_worker_start_stop_is_idempotent(db_url: str) -> None:
    """Manual worker lifecycle controls should be safe for lifespan wiring."""
    await start_delivery_worker(
        db_url,
        poll_seconds=0.05,
        lease_seconds=30,
        batch_size=5,
    )
    await start_delivery_worker(
        db_url,
        poll_seconds=0.05,
        lease_seconds=30,
        batch_size=5,
    )
    await asyncio.sleep(0.05)
    await stop_delivery_worker()
    await stop_delivery_worker()


@pytest.mark.asyncio
async def test_lifespan_starts_and_stops_firehose_delivery_worker(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An enabled Firehose delivery worker should be owned by the API lifespan."""
    _patch_mcp_session_manager(monkeypatch)
    settings = Settings(
        database_url=db_url,
        deploy_mode="local",
        discovery_job_worker_enabled=False,
        firehose_delivery_worker_enabled=True,
        firehose_delivery_worker_poll_seconds=0.5,
        firehose_delivery_worker_lease_seconds=45,
        firehose_delivery_worker_batch_size=7,
    )

    started: list[dict[str, object]] = []
    stopped: list[bool] = []

    async def fake_start(database_url: str, **kwargs: object) -> None:
        started.append({"database_url": database_url, **kwargs})

    async def fake_stop() -> None:
        stopped.append(True)

    monkeypatch.setattr(
        "atlas.domains.firehose.delivery_worker.start_delivery_worker",
        fake_start,
    )
    monkeypatch.setattr(
        "atlas.domains.firehose.delivery_worker.stop_delivery_worker",
        fake_stop,
    )

    mock_app = MagicMock()
    with patch("atlas.main.get_settings", return_value=settings):
        async with lifespan(mock_app):
            assert started == [
                {
                    "database_url": db_url,
                    "database_backend": "sqlite",
                    "poll_seconds": 0.5,
                    "lease_seconds": 45,
                    "batch_size": 7,
                }
            ]

    assert stopped == [True]


@pytest.mark.asyncio
async def test_worker_loop_logs_processed_deliveries(monkeypatch: pytest.MonkeyPatch) -> None:
    """The polling loop should close connections after processing visible work."""
    conn = _FakeConnection()

    async def fake_get_db_connection(_database_url: str, **_kwargs: object) -> _FakeConnection:
        return conn

    async def fake_process_due_observation_deliveries(
        _conn: object,
        **_kwargs: object,
    ) -> delivery_worker.FirehoseDeliveryProcessingResult:
        return delivery_worker.FirehoseDeliveryProcessingResult(
            processed=1,
            delivered=1,
            failed=0,
        )

    async def cancel_after_sleep(_seconds: float) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(delivery_worker, "get_db_connection", fake_get_db_connection)
    monkeypatch.setattr(
        delivery_worker,
        "process_due_observation_deliveries",
        fake_process_due_observation_deliveries,
    )
    monkeypatch.setattr(delivery_worker.asyncio, "sleep", cancel_after_sleep)

    with pytest.raises(asyncio.CancelledError):
        await delivery_worker._worker_loop(  # noqa: SLF001
            "sqlite:///tmp/test.db",
            database_backend=None,
            poll_seconds=0.01,
            lease_seconds=30,
            batch_size=5,
        )

    assert conn.closed is True


@pytest.mark.asyncio
async def test_worker_loop_retries_after_unexpected_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unexpected worker errors should wait for the next poll instead of exiting silently."""
    sleep_calls: list[float] = []

    async def failing_get_db_connection(_database_url: str, **_kwargs: object) -> object:
        raise RuntimeError(DATABASE_UNAVAILABLE_MESSAGE)

    async def cancel_after_retry(seconds: float) -> None:
        sleep_calls.append(seconds)
        raise asyncio.CancelledError

    monkeypatch.setattr(delivery_worker, "get_db_connection", failing_get_db_connection)
    monkeypatch.setattr(delivery_worker.asyncio, "sleep", cancel_after_retry)

    with pytest.raises(asyncio.CancelledError):
        await delivery_worker._worker_loop(  # noqa: SLF001
            "sqlite:///tmp/test.db",
            database_backend=None,
            poll_seconds=0.25,
            lease_seconds=30,
            batch_size=5,
        )

    assert sleep_calls == [0.25]
