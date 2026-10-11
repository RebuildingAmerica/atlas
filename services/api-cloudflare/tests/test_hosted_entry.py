"""Durable Object entry connects the same wake owner to requests and alarms."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


def load_entry(monkeypatch, *, package_error=None):
    class DurableObject:
        def __init__(self, ctx, env):
            self.ctx, self.env = ctx, env

    response = SimpleNamespace(json=lambda body, **kwargs: body)
    asgi = SimpleNamespace(fetch=AsyncMock(return_value="response"))
    monkeypatch.setitem(
        sys.modules,
        "workers",
        SimpleNamespace(
            DurableObject=DurableObject,
            WorkerEntrypoint=DurableObject,
            Response=response,
            asgi=asgi,
        ),
    )
    bootstrap = AsyncMock(side_effect=package_error)
    monkeypatch.setitem(
        sys.modules,
        "package_bootstrap",
        SimpleNamespace(ensure_package_archive=bootstrap),
    )
    monkeypatch.setitem(
        sys.modules,
        "timer_cleanup",
        SimpleNamespace(install_timer_cleanup=lambda: True),
    )
    path = Path(__file__).parents[1] / "compatibility" / "entry.py"
    spec = importlib.util.spec_from_file_location("hosted_entry_test", path)
    entry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(entry)
    return entry, bootstrap, asgi


@pytest.mark.asyncio
async def test_requests_and_restart_alarm_use_instance_owned_adapter(monkeypatch):
    entry, bootstrap, asgi = load_entry(monkeypatch)
    adapters = []
    environments = []
    owners = []

    def make_adapter(env, storage):
        adapter = SimpleNamespace(alarm=AsyncMock())
        adapters.append(adapter)
        environments.append(env)
        return adapter

    def make_application(env, *, strip_evaluation_prefix, firehose_wake):
        assert strip_evaluation_prefix
        owners.append(firehose_wake)
        return object(), 12

    monkeypatch.setitem(
        sys.modules, "hosted_jobs", SimpleNamespace(create_firehose_alarm=make_adapter)
    )
    monkeypatch.setitem(
        sys.modules,
        "hosted_application",
        SimpleNamespace(create_hosted_application=make_application),
    )
    storage = SimpleNamespace(setAlarm=AsyncMock())
    env = object()
    first = entry.ApiRuntime(SimpleNamespace(storage=storage), env)
    request = SimpleNamespace(url="https://private.example.com/atlas/health")
    assert await first.fetch(request) == "response"
    assert await first.fetch(request) == "response"
    await first.alarm()
    assert owners == [adapters[0]]
    adapters[0].alarm.assert_awaited_once()
    assert len(adapters) == 1
    # Eviction creates a new owner using the same durable storage and config.
    restarted = entry.ApiRuntime(SimpleNamespace(storage=storage), env)
    await restarted.alarm()
    assert len(adapters) == 2
    adapters[1].alarm.assert_awaited_once()
    assert environments == [env, env]
    assert storage.setAlarm.await_count == 2
    assert bootstrap.await_count == 4


@pytest.mark.asyncio
async def test_alarm_package_failure_retains_rescue_alarm(monkeypatch):
    entry, _, _ = load_entry(
        monkeypatch, package_error=ConnectionError("archive unavailable")
    )
    storage = SimpleNamespace(setAlarm=AsyncMock())
    runtime = entry.ApiRuntime(SimpleNamespace(storage=storage), object())
    with pytest.raises(ConnectionError, match="archive unavailable"):
        await runtime.alarm()
    storage.setAlarm.assert_awaited_once()
    assert not hasattr(runtime, "_firehose")
