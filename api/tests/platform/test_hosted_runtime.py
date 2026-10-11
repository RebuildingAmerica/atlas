"""Hosted requests keep configuration and database ownership isolated."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from atlas.models.database import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime, current_hosted_runtime


def test_runtime_scope_restores_after_nested_failure() -> None:
    """Failed inner work cannot replace the surrounding request's settings."""
    outer = HostedRuntime(settings=Settings(multi_user=False), connect=AsyncMock())
    inner = HostedRuntime(settings=Settings(multi_user=False), connect=AsyncMock())

    def fail_inner_request() -> None:
        with bind_hosted_runtime(inner):
            assert get_settings() is inner.settings
            message = "request failed"
            raise RuntimeError(message)

    assert current_hosted_runtime() is None
    with bind_hosted_runtime(outer):
        assert get_settings() is outer.settings
        with pytest.raises(RuntimeError, match="request failed"):
            fail_inner_request()
        assert get_settings() is outer.settings
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_concurrent_requests_keep_settings_and_connections_separate() -> None:
    """Concurrent hosted callers cannot inherit each other's database context."""
    ready = asyncio.Event()
    entered = 0

    async def request(label: str) -> None:
        nonlocal entered
        settings = Settings(database_url=f"sqlite:///{label}.db", multi_user=False)
        connection = object()
        connector = AsyncMock(return_value=connection)
        runtime = HostedRuntime(settings=settings, connect=connector)
        with bind_hosted_runtime(runtime):
            entered += 1
            if entered == 2:
                ready.set()
            await ready.wait()
            assert get_settings() is settings
            assert await get_db_connection(settings.database_url, backend="postgres") is connection
            connector.assert_awaited_once_with(settings.database_url, backend="postgres")
        assert current_hosted_runtime() is None

    await asyncio.gather(request("first"), request("second"))
    assert current_hosted_runtime() is None
