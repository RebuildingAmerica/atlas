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
        "snapshot_bootstrap",
        SimpleNamespace(preload_core_packages=lambda: False),
    )
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
    probe_path = Path(__file__).parents[1] / "compatibility" / "runtime_probe.py"
    probe_spec = importlib.util.spec_from_file_location("runtime_probe", probe_path)
    probe = importlib.util.module_from_spec(probe_spec)
    probe_spec.loader.exec_module(probe)
    monkeypatch.setitem(sys.modules, "runtime_probe", probe)
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


@pytest.mark.asyncio
async def test_runtime_diagnostics_distinguish_object_and_isolate_restart(monkeypatch):
    entry, bootstrap, _ = load_entry(monkeypatch)
    context = SimpleNamespace(storage=SimpleNamespace(setAlarm=AsyncMock()))
    environment = SimpleNamespace(ATLAS_API_SETTINGS="private-settings-secret")
    request = SimpleNamespace(url="https://private.example.com/runtime-state")
    first = entry.ApiRuntime(context, environment)
    before = await first.fetch(request)
    again = await first.fetch(request)
    restarted = entry.ApiRuntime(context, environment)
    other = await restarted.fetch(request)
    assert before["object_boot"] == again["object_boot"]
    assert again["object_boot"] != other["object_boot"]
    assert before["isolate_boot"] == other["isolate_boot"]
    assert before["object_requests"] == 1
    assert again["object_requests"] == 2
    assert other["object_requests"] == 1
    assert other["isolate_requests"] == 3
    assert not before["application_cached"]
    assert "private-settings-secret" not in str(other)
    bootstrap.assert_not_awaited()
    new_entry, _, _ = load_entry(monkeypatch)
    new_isolate = await new_entry.ApiRuntime(context, environment).fetch(request)
    assert new_isolate["isolate_boot"] != before["isolate_boot"]


@pytest.mark.asyncio
async def test_import_diagnostics_report_one_factory_build_and_cache_reuse(monkeypatch):
    entry, _, _ = load_entry(monkeypatch)
    monkeypatch.setitem(
        sys.modules,
        "hosted_jobs",
        SimpleNamespace(create_firehose_alarm=lambda *_: object()),
    )
    builds = []

    def create(env, **kwargs):
        builds.append((env, kwargs))
        return object(), 12

    monkeypatch.setitem(
        sys.modules,
        "hosted_application",
        SimpleNamespace(create_hosted_application=create),
    )
    runtime = entry.ApiRuntime(SimpleNamespace(storage=object()), object())
    request = SimpleNamespace(url="https://private.example.com/imports")
    first = await runtime.fetch(request)
    second = await runtime.fetch(request)
    assert first["status"] == second["status"] == "ok"
    assert first["diagnostics"]["application_builds"] == 1
    assert second["diagnostics"]["application_builds"] == 1
    assert first["diagnostics"]["object_boot"] == second["diagnostics"]["object_boot"]
    assert first["diagnostics"]["package_checks"] == 1
    assert second["diagnostics"]["package_checks"] == 2
    assert len(builds) == 1
