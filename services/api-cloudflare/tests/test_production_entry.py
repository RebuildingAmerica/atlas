"""The production object serves original routes and explicitly controlled consumers."""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from test_consumer_control import DIGEST, SECRET, SHA, Storage, request


def environment(inline=False):
    return SimpleNamespace(
        ATLAS_RELEASE_SHA=SHA,
        ATLAS_SCHEMA_RECEIPT_DIGEST=DIGEST,
        ATLAS_API_SETTINGS=json.dumps(
            {
                "ENVIRONMENT": "production",
                "DATABASE_BACKEND": "postgres",
                "DATABASE_URL": "postgresql://operator:secret@database.example.com/atlas",
                "ATLAS_MULTI_USER": "true",
                "ATLAS_MANAGED": "true",
                "ATLAS_PUBLIC_URL": "https://reader.example.com",
                "ATLAS_AUTH_INTERNAL_SECRET": SECRET,
                "ATLAS_AUTH_JWT_AUDIENCES": "https://reader.example.com/mcp,https://reader.example.com/api",
                "ATLAS_AUTH_API_KEY_INTROSPECTION_URL": "https://reader.example.com/api/auth/api-key/verify",
                "ATLAS_AUTH_MEMBERSHIP_URL": "https://reader.example.com/api/auth/membership",
                "CORS_ORIGINS": '["https://reader.example.com"]',
                "DISCOVERY_INLINE": inline,
            }
        ),
        HYPERDRIVE=SimpleNamespace(
            host="hyperdrive.example.com",
            port="5432",
            user="operator",
            password="private-password",
            database="atlas",
        ),
    )


def load_entry(monkeypatch, *, package_error=None, timer_ok=True):
    root = Path(__file__).parents[1]
    monkeypatch.syspath_prepend(str(root / "production"))
    monkeypatch.syspath_prepend(str(root / "compatibility"))

    class DurableObject:
        def __init__(self, ctx, env):
            self.ctx, self.env = ctx, env

    class Response:
        def __init__(self, body, status=200, headers=None):
            self.body, self.status, self.headers = body, status, headers

        @classmethod
        def json(cls, body, **kwargs):
            return cls(body, **kwargs)

    asgi = SimpleNamespace(fetch=AsyncMock(return_value="original-response"))
    monkeypatch.setitem(
        sys.modules,
        "workers",
        SimpleNamespace(
            DurableObject=DurableObject,
            WorkerEntrypoint=DurableObject,
            Response=Response,
            asgi=asgi,
        ),
    )
    packages = AsyncMock(side_effect=package_error)
    monkeypatch.setitem(
        sys.modules,
        "package_bootstrap",
        SimpleNamespace(
            ensure_package_archive=packages,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "snapshot_bootstrap",
        SimpleNamespace(
            preload_core_packages=lambda: False,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "timer_cleanup",
        SimpleNamespace(
            install_timer_cleanup=lambda: timer_ok,
        ),
    )
    # A fresh import must use this test's Workers response implementation.
    monkeypatch.delitem(sys.modules, "consumer_control", raising=False)
    spec = importlib.util.spec_from_file_location(
        "production_entry_test", root / "production" / "production_entry.py"
    )
    entry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(entry)
    return entry, packages, asgi


def make_request(path, method="GET", **kwargs):
    value = request(method, **kwargs)
    value.url = "https://reader.example.com" + path
    return value


@pytest.mark.asyncio
async def test_release_and_default_need_no_application_or_bindings(monkeypatch):
    entry, packages, asgi = load_entry(monkeypatch)
    env = SimpleNamespace(ATLAS_RELEASE_SHA=SHA, ATLAS_SCHEMA_RECEIPT_DIGEST=DIGEST)
    runtime = entry.ApiRuntime(SimpleNamespace(storage=Storage()), env)
    response = await runtime.fetch(make_request("/__atlas/release"))
    assert response.status == 200
    assert response.body == {
        "releaseSha": SHA,
        "runtimeRole": "api",
        "schemaReceiptDigest": DIGEST,
    }
    assert response.headers["Cache-Control"] == "private, no-store"
    assert (await runtime.fetch(make_request("/__atlas/release", "POST"))).status == 405
    assert (await entry.Default(None, env).fetch(make_request("/health"))).status == 403
    packages.assert_not_awaited()
    asgi.fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_original_paths_cache_factory_and_lazily_resolve_discovery(monkeypatch):
    entry, packages, asgi = load_entry(monkeypatch)
    env = environment()
    adapter = SimpleNamespace(alarm=AsyncMock())
    monkeypatch.setitem(
        sys.modules,
        "hosted_jobs",
        SimpleNamespace(
            create_firehose_alarm=lambda _env, _storage: adapter,
        ),
    )
    owners = []

    def create(_env, **kwargs):
        owners.append(kwargs)
        return object(), 12

    from hosted_application import _settings

    monkeypatch.setitem(
        sys.modules,
        "hosted_application",
        SimpleNamespace(
            create_hosted_application=create,
            _settings=_settings,
        ),
    )
    runtime = entry.ApiRuntime(SimpleNamespace(storage=Storage()), env)
    for path in (
        "/health",
        "/api/entities",
        "/atlas/health",
        "/runtime-state",
        "/native",
    ):
        assert await runtime.fetch(make_request(path)) == "original-response"
        assert asgi.fetch.await_args.args[1].url.endswith(path)
    assert len(owners) == 1
    assert owners[0]["strip_evaluation_prefix"] is False
    assert owners[0]["firehose_wake"] is adapter
    wake = owners[0]["discovery_wake"]
    with pytest.raises(RuntimeError, match="Discovery runtime binding is required"):
        await wake.prepare_wake("receipt")
    remote = SimpleNamespace(
        prepare_wake=AsyncMock(return_value="retained"),
        confirm_wake=AsyncMock(),
        abort_wake=AsyncMock(),
    )
    names = []
    env.DISCOVERY_RUNTIME = SimpleNamespace(
        getByName=lambda name: names.append(name) or remote
    )
    assert await wake.prepare_wake("receipt") == "retained"
    await wake.confirm_wake("receipt")
    await wake.abort_wake("receipt")
    assert names == ["application"] * 3
    remote.prepare_wake.assert_awaited_once_with("receipt")
    remote.confirm_wake.assert_awaited_once_with("receipt")
    remote.abort_wake.assert_awaited_once_with("receipt")
    packages.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("inline", [False, "false", True, "true"])
async def test_only_inline_execution_requests_load_assets(monkeypatch, inline):
    entry, packages, _ = load_entry(monkeypatch)
    from hosted_application import _settings

    monkeypatch.setitem(
        sys.modules,
        "hosted_application",
        SimpleNamespace(
            _settings=_settings,
            create_hosted_application=lambda *_a, **_kw: (object(), 1),
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "hosted_jobs",
        SimpleNamespace(
            create_firehose_alarm=lambda *_: object(),
        ),
    )
    runtime = entry.ApiRuntime(SimpleNamespace(storage=Storage()), environment(inline))
    for path, method in (
        ("/health", "GET"),
        ("/api/discovery-runs", "GET"),
        ("/api/discovery-runs", "POST"),
        ("/mcp/", "POST"),
        ("/%61pi/discovery-runs", "POST"),
        ("/%6dcp", "POST"),
    ):
        await runtime.fetch(make_request(path, method))
    assert packages.await_count == (4 if inline in (True, "true") else 0)


@pytest.mark.asyncio
async def test_paused_alarm_never_constructs_services_and_enabled_alarm_uses_gate(
    monkeypatch,
):
    entry, packages, _ = load_entry(monkeypatch)
    runtime = entry.ApiRuntime(SimpleNamespace(storage=Storage()), environment())
    await runtime.alarm()
    packages.assert_not_awaited()
    assert not hasattr(runtime, "_firehose")
    control_response = await runtime.fetch(make_request("/__atlas/consumers"))
    assert control_response.body == {"releaseSha": SHA, "enabled": False}
    response = await runtime.fetch(
        make_request(
            "/__atlas/consumers",
            "POST",
            body={"releaseSha": SHA, "enabled": True},
        )
    )
    assert response.body["enabled"] is True
    adapter = SimpleNamespace(alarm=AsyncMock())
    storage_owners = []

    def create(_env, storage):
        storage_owners.append(storage)
        return adapter

    monkeypatch.setitem(
        sys.modules, "hosted_jobs", SimpleNamespace(create_firehose_alarm=create)
    )
    await runtime.alarm()
    packages.assert_not_awaited()
    adapter.alarm.assert_awaited_once()
    assert storage_owners == [runtime._consumer_control().gated_storage]


@pytest.mark.asyncio
async def test_enabled_alarm_timer_failure_retains_rescue_without_constructing_adapter(
    monkeypatch,
):
    entry, _, _ = load_entry(monkeypatch, timer_ok=False)
    runtime = entry.ApiRuntime(SimpleNamespace(storage=Storage()), environment())
    await runtime.fetch(
        make_request(
            "/__atlas/consumers",
            "POST",
            body={"releaseSha": SHA, "enabled": True},
        )
    )
    with pytest.raises(RuntimeError, match="selected hosted loop"):
        await runtime.alarm()
    assert runtime.ctx.storage.alarm_at is not None
    assert await runtime._consumer_control().is_enabled()
    assert not hasattr(runtime, "_firehose")


@pytest.mark.asyncio
async def test_real_firehose_producer_receipts_survive_pause_and_restart(monkeypatch):
    entry, packages, _ = load_entry(monkeypatch)
    storage = Storage()
    runtime = entry.ApiRuntime(SimpleNamespace(storage=storage), environment())
    await runtime.prepare_wake("pending-observation")
    adapter = runtime._firehose_adapter()
    assert (await adapter._state())["pending"] == ["pending-observation"]
    assert storage.alarm_at is None
    restarted = entry.ApiRuntime(SimpleNamespace(storage=storage), environment())
    await restarted.confirm_wake("pending-observation")
    assert (await restarted._firehose_adapter()._state())["pending"] == []
    await restarted.prepare_wake("rolled-back-observation")
    await restarted.abort_wake("rolled-back-observation")
    assert (await restarted._firehose_adapter()._state())["pending"] == []
    assert storage.alarm_at is None
    packages.assert_not_awaited()


@pytest.mark.asyncio
async def test_real_health_private_routes_and_diagnostics_keep_original_behavior(
    monkeypatch,
):
    entry, packages, asgi = load_entry(monkeypatch)
    import hosted_application

    import atlas.main

    monkeypatch.setattr(
        atlas.main, "init_db", AsyncMock(side_effect=AssertionError("No migrations"))
    )

    async def forbidden_connect(**kwargs):
        pytest.fail("Health or unauthenticated route opened a database connection")

    monkeypatch.setattr(hosted_application, "connect_database", forbidden_connect)

    async def fetch(app, req, _env):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client:
            return await client.request(req.method, req.url)

    asgi.fetch.side_effect = fetch
    runtime = entry.ApiRuntime(SimpleNamespace(storage=Storage()), environment())
    assert (await runtime.fetch(make_request("/health"))).json() == {"status": "ok"}
    for path in ("/api/lists", "/mcp"):
        assert (await runtime.fetch(make_request(path))).status_code == 401
    for path in (
        "/atlas/health",
        "/imports",
        "/runtime-state",
        "/native",
        "/timer-fixed/30",
    ):
        assert (await runtime.fetch(make_request(path))).status_code == 404
    packages.assert_not_awaited()
    atlas.main.init_db.assert_not_awaited()


def test_real_delivery_alarm_does_not_need_extraction_assets(tmp_path):
    script = """
import asyncio, importlib.abc, json, logging, sys
from types import SimpleNamespace
class ExtractionUnavailable(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {
            'babel', 'dateparser', 'pytz', 'urllib3', 'probablepeople',
            'trafilatura', 'lxml', 'inflate64', 'pycrfsuite',
        }:
            raise AssertionError('Inbox delivery imported extraction resources')
sys.meta_path.insert(0, ExtractionUnavailable())
import aiosqlite, pytest
import test_production_entry as harness
from atlas.models.database import init_db
from atlas.domains.firehose.models import FirehoseObservationCRUD, FirehoseObservationCreate
logging.disable(logging.CRITICAL)
patch = pytest.MonkeyPatch()
entry, packages, _ = harness.load_entry(patch)
import hosted_application
async def main():
    path = sys.argv[1]
    await init_db('sqlite:///' + path, backend='sqlite')
    async def connect(**kwargs):
        return await aiosqlite.connect(path)
    hosted_application.connect_database = connect
    async with aiosqlite.connect(path) as connection:
        observation = await FirehoseObservationCRUD.create(connection, FirehoseObservationCreate(
            producer='discovery_sync', observation_type='actor_discovered',
            subject_type='entry', subject_id='actor-one', org_id='workspace-one',
            coverage_target_id=None, places=[], issues=[], source_class='discovery_run',
            occurred_at=None, observed_at='2026-01-01T00:00:00+00:00',
            dedupe_key='retained-source-one', public_realm_basis='Public source',
            confidence=0.8, sensitivity=0.1, payload={'title': 'New civic actor'}, evidence=[],
        ))
        runtime = entry.ApiRuntime(SimpleNamespace(storage=harness.Storage()), harness.environment())
        await runtime.fetch(harness.make_request('/__atlas/consumers', 'POST',
            body={'releaseSha': harness.SHA, 'enabled': True}))
        result = await runtime.alarm()
        assert (result.processed, result.delivered, result.failed) == (1, 1, 0)
        packages.assert_not_awaited()
        row = await (await connection.execute(
            'SELECT title FROM firehose_signals WHERE primary_observation_id = ?',
            (observation.id,),
        )).fetchone()
        assert row == ('New civic actor',)
        assert runtime.ctx.storage.alarm_at is None
    print(json.dumps({'delivered': 1, 'assetsLoaded': False}))
asyncio.run(main())
"""
    root = Path(__file__).parents[1]
    output = subprocess.check_output(
        [sys.executable, "-c", script, str(tmp_path / "inbox.sqlite")],
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                (str(root / "tests"), str(root / "compatibility"))
            ),
        },
    )
    assert json.loads(output) == {"delivered": 1, "assetsLoaded": False}
