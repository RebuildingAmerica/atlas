"""Durable Object entry connects the same wake owner to requests and alarms."""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


def production_environment(inline=False):
    return SimpleNamespace(
        ATLAS_API_SETTINGS=json.dumps(
            {
                "ENVIRONMENT": "production",
                "DATABASE_BACKEND": "postgres",
                "DATABASE_URL": "postgresql://operator:secret@database.example.com/atlas",
                "ATLAS_MULTI_USER": "true",
                "ATLAS_MANAGED": "true",
                "ATLAS_PUBLIC_URL": "https://reader.example.com",
                "ATLAS_AUTH_INTERNAL_SECRET": "private-internal-secret",
                "ATLAS_AUTH_JWT_AUDIENCES": "https://reader.example.com/mcp,https://reader.example.com/api",
                "ATLAS_AUTH_API_KEY_INTROSPECTION_URL": "https://reader.example.com/api/auth/api-key/verify",
                "ATLAS_AUTH_MEMBERSHIP_URL": "https://reader.example.com/api/auth/membership",
                "CORS_ORIGINS": '["https://reader.example.com"]',
                "DISCOVERY_INLINE": inline,
            }
        )
    )


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
        SimpleNamespace(
            create_hosted_application=make_application,
            _settings=lambda _: SimpleNamespace(discovery_inline=False),
        ),
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
    assert bootstrap.await_count == 2


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
        SimpleNamespace(
            create_hosted_application=create,
            _settings=lambda _: SimpleNamespace(discovery_inline=False),
        ),
    )
    runtime = entry.ApiRuntime(SimpleNamespace(storage=object()), object())
    request = SimpleNamespace(url="https://private.example.com/imports")
    first = await runtime.fetch(request)
    second = await runtime.fetch(request)
    assert first["status"] == second["status"] == "ok"
    assert first["diagnostics"]["application_builds"] == 1
    assert second["diagnostics"]["application_builds"] == 1
    assert first["diagnostics"]["object_boot"] == second["diagnostics"]["object_boot"]
    assert first["diagnostics"]["package_checks"] == 0
    assert second["diagnostics"]["package_checks"] == 0
    assert len(builds) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("inline", [False, "false", True, "true"])
async def test_http_loads_deferred_packages_only_for_typed_inline_discovery(
    monkeypatch, inline
):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / "compatibility"))
    from hosted_application import _settings

    entry, bootstrap, asgi = load_entry(monkeypatch)
    environment = production_environment(inline)
    monkeypatch.setitem(
        sys.modules,
        "hosted_jobs",
        SimpleNamespace(create_firehose_alarm=lambda *_: object()),
    )
    calls = []

    def make_application(*args, **kwargs):
        # Inline REST/MCP extraction must have its assets before ASGI dispatch.
        assert bootstrap.await_count == int(inline in (True, "true"))
        calls.append(args)
        return object(), 12

    monkeypatch.setitem(
        sys.modules,
        "hosted_application",
        SimpleNamespace(
            create_hosted_application=make_application, _settings=_settings
        ),
    )
    runtime = entry.ApiRuntime(SimpleNamespace(storage=object()), environment)
    for path in ("/atlas/health", "/atlas/api/discovery-runs", "/atlas/mcp"):
        assert (
            await runtime.fetch(
                SimpleNamespace(url="https://private.example.com" + path)
            )
            == "response"
        )
    assert len(calls) == 1
    assert asgi.fetch.await_count == 3
    assert bootstrap.await_count == (3 if inline in (True, "true") else 0)


@pytest.mark.asyncio
async def test_invalid_inline_configuration_is_sanitized_before_archive_io(monkeypatch):
    entry, bootstrap, asgi = load_entry(monkeypatch)

    def invalid(_):
        raise ValueError("private-settings-secret")

    monkeypatch.setitem(
        sys.modules, "hosted_application", SimpleNamespace(_settings=invalid)
    )
    runtime = entry.ApiRuntime(SimpleNamespace(storage=object()), object())
    with pytest.raises(RuntimeError, match="Invalid hosted API configuration") as error:
        await runtime.fetch(
            SimpleNamespace(url="https://private.example.com/atlas/health")
        )
    assert "private-settings-secret" not in str(error.value)
    assert error.value.__suppress_context__
    bootstrap.assert_not_awaited()
    asgi.fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_non_application_probe_retains_deferred_packages(monkeypatch):
    entry, bootstrap, asgi = load_entry(monkeypatch)
    probe = object()
    monkeypatch.setitem(sys.modules, "app_probe", SimpleNamespace(app=probe))
    runtime = entry.ApiRuntime(SimpleNamespace(storage=object()), object())
    assert (
        await runtime.fetch(SimpleNamespace(url="https://private.example.com/native"))
        == "response"
    )
    bootstrap.assert_awaited_once()
    assert asgi.fetch.await_args.args[0] is probe


def test_real_factory_catalog_auth_and_mcp_without_deferred_packages(tmp_path):
    script = """
import asyncio, importlib.abc, json, logging, sys
from types import SimpleNamespace
class DeferredUnavailable(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"babel", "dateparser", "pytz", "urllib3"}:
            raise AssertionError("Ordinary HTTP imported deferred extraction resources")
sys.meta_path.insert(0, DeferredUnavailable())
import aiosqlite, httpx
import hosted_application
from hosted_jobs import create_firehose_alarm
from atlas.models.database import init_db
logging.disable(logging.CRITICAL)
env = SimpleNamespace(
    ATLAS_API_SETTINGS=sys.argv[1],
    HYPERDRIVE=SimpleNamespace(host="database.example.com", port="5432",
        user="operator", password="fake-password", database="atlas"),
)
async def wake(*args):
    pass
storage = SimpleNamespace(setAlarm=wake)
adapter = create_firehose_alarm(env, storage)
app, count = hosted_application.create_hosted_application(env, firehose_wake=adapter)
async def main():
    path = sys.argv[2]
    await init_db("sqlite:///" + path, backend="sqlite")
    async def connect(**kwargs):
        # This regression proves package closure; PostgreSQL behavior has its
        # independent adapter suite and hosted acceptance checks.
        return await aiosqlite.connect(path)
    hosted_application.connect_database = connect
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
            base_url="https://reader.example.com") as client:
        result = {}
        for endpoint in ("/health", "/api/entities?limit=2",
                "/api/entities?q=transit", "/api/lists", "/mcp"):
            result[endpoint] = (await client.get(endpoint)).status_code
        print(json.dumps(result))
asyncio.run(main())
"""
    compatibility = Path(__file__).parents[1] / "compatibility"
    output = subprocess.check_output(
        [
            sys.executable,
            "-c",
            script,
            production_environment().ATLAS_API_SETTINGS,
            str(tmp_path / "catalog.sqlite"),
        ],
        env={**os.environ, "PYTHONPATH": str(compatibility)},
    )
    assert json.loads(output) == {
        "/health": 200,
        "/api/entities?limit=2": 200,
        "/api/entities?q=transit": 200,
        "/api/lists": 401,
        "/mcp": 401,
    }
