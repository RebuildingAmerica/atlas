"""Production discovery is release-bound, paused, and scoped to one alarm turn."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from test_consumer_control import DIGEST, SHA, Storage
from test_production_entry import environment, load_entry, make_request


def load_discovery(monkeypatch, **kwargs):
    _, packages, _ = load_entry(monkeypatch, **kwargs)
    spec = importlib.util.spec_from_file_location(
        "production_discovery_test",
        Path(__file__).parents[1] / "production" / "production_discovery.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, packages


@pytest.mark.asyncio
async def test_release_health_and_paused_alarm_do_not_start_research(monkeypatch):
    module, packages = load_discovery(monkeypatch)
    env = environment()
    runtime = module.DiscoveryRuntime(SimpleNamespace(storage=Storage()), env)
    identity = await runtime.fetch(make_request("/__atlas/release"))
    assert identity.body == {
        "releaseSha": SHA,
        "runtimeRole": "discovery",
        "schemaReceiptDigest": DIGEST,
    }
    assert (await runtime.fetch(make_request("/health"))).body == {"status": "ok"}
    assert (await runtime.fetch(make_request("/health", "POST"))).status == 405
    assert (await runtime.fetch(make_request("/unknown"))).status == 404
    assert (
        await module.Default(None, env).fetch(make_request("/health"))
    ).status == 403
    response = await runtime.fetch(make_request("/__atlas/consumers"))
    assert response.body == {"releaseSha": SHA, "enabled": False}
    assert await runtime.alarm() is None
    packages.assert_not_awaited()
    assert not hasattr(runtime, "_discovery")


@pytest.mark.asyncio
async def test_paused_real_adapter_retains_receipts_and_initial_enable_arms_handoff(
    monkeypatch,
):
    module, packages = load_discovery(monkeypatch)
    # Actual runtime factory; creating or waking it must not open SQL.
    import hosted_application

    connect = AsyncMock(side_effect=AssertionError("Paused consumer must not connect"))
    monkeypatch.setattr(hosted_application, "connect_database", connect)
    monkeypatch.setitem(
        sys.modules,
        "public_source_transport",
        SimpleNamespace(workers_public_source_fetch=object()),
    )
    storage = Storage()
    runtime = module.DiscoveryRuntime(SimpleNamespace(storage=storage), environment())
    await runtime.prepare_wake("committing-search-job")
    assert storage.alarm_at is None
    assert (await runtime._discovery_adapter()._state()).pending == [
        "committing-search-job"
    ]
    await runtime.confirm_wake("committing-search-job")
    await runtime.prepare_wake("rolled-back")
    await runtime.abort_wake("rolled-back")
    assert (await runtime._discovery_adapter()._state()).pending == []
    response = await runtime.fetch(
        make_request(
            "/__atlas/consumers", "POST", body={"releaseSha": SHA, "enabled": True}
        )
    )
    assert response.body["enabled"] is True
    assert storage.alarm_at is not None
    connect.assert_not_awaited()
    packages.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [None, "packages", "timers"])
async def test_enabled_alarm_loads_packages_then_runs_one_unit_and_keeps_rescue(
    monkeypatch, failure
):
    module, packages = load_discovery(
        monkeypatch,
        package_error=RuntimeError("packages") if failure == "packages" else None,
        timer_ok=failure != "timers",
    )
    storage = Storage()
    runtime = module.DiscoveryRuntime(SimpleNamespace(storage=storage), environment())
    adapter = SimpleNamespace(alarm=AsyncMock(return_value="one-turn"))
    monkeypatch.setattr(module, "create_discovery_alarm", lambda *_: adapter)
    await runtime.fetch(
        make_request(
            "/__atlas/consumers", "POST", body={"releaseSha": SHA, "enabled": True}
        )
    )
    if failure:
        with pytest.raises(RuntimeError):
            await runtime.alarm()
        adapter.alarm.assert_not_awaited()
    else:
        assert await runtime.alarm() == "one-turn"
        adapter.alarm.assert_awaited_once()
        packages.assert_awaited_once()
    assert storage.alarm_at is not None


@pytest.mark.asyncio
async def test_factory_and_sibling_wake_keep_resources_explicit(monkeypatch):
    module, _ = load_discovery(monkeypatch)
    import hosted_application

    source_fetch = object()
    monkeypatch.setitem(
        sys.modules,
        "public_source_transport",
        SimpleNamespace(workers_public_source_fetch=source_fetch),
    )
    connection = object()
    connect = AsyncMock(return_value=connection)
    monkeypatch.setattr(hosted_application, "connect_database", connect)
    env = environment()
    adapter = module.create_discovery_alarm(env, Storage())
    assert adapter.runtime.public_source_fetch is source_fetch
    assert (
        await adapter.runtime.connect(
            adapter.runtime.settings.database_url, backend="postgres"
        )
        is connection
    )
    assert connect.await_args.kwargs["host"] == "hyperdrive.example.com"
    with pytest.raises(RuntimeError, match="mismatch"):
        await adapter.runtime.connect("postgresql://wrong/db")
    with pytest.raises(RuntimeError, match="binding"):
        await adapter.runtime.firehose_wake.prepare_wake("observation")
    owner = SimpleNamespace(
        prepare_wake=AsyncMock(), confirm_wake=AsyncMock(), abort_wake=AsyncMock()
    )
    env.API_RUNTIME = SimpleNamespace(
        getByName=lambda name: owner if name == "application" else None
    )
    await adapter.runtime.firehose_wake.prepare_wake("observation")
    await adapter.runtime.firehose_wake.confirm_wake("observation")
    await adapter.runtime.firehose_wake.abort_wake("observation")
    owner.prepare_wake.assert_awaited_once_with("observation")
    owner.confirm_wake.assert_awaited_once_with("observation")
    owner.abort_wake.assert_awaited_once_with("observation")
    env.HYPERDRIVE.port = 0
    with pytest.raises(RuntimeError, match="Invalid hosted"):
        module.create_discovery_alarm(env, Storage())
