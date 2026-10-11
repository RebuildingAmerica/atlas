"""Hosted HTTP preserves production auth and request-owned database resources."""

import asyncio
import importlib
import importlib.util
import json
from types import SimpleNamespace

import httpx
import pytest


def module():
    assert importlib.util.find_spec("hosted_application") is not None, (
        "Hosted app is missing"
    )
    return importlib.import_module("hosted_application")


def environment(label="reader", **overrides):
    origin = f"https://{label}.example.com"
    values = {
        "ENVIRONMENT": "production",
        "DATABASE_BACKEND": "postgres",
        "DATABASE_URL": "postgresql://operator:private-password@database.example.com/atlas",
        "ATLAS_MULTI_USER": "true",
        "ATLAS_MANAGED": "true",
        "ATLAS_PUBLIC_URL": origin,
        "ATLAS_AUTH_INTERNAL_SECRET": f"private-{label}-internal-secret",
        "ATLAS_AUTH_JWT_AUDIENCES": f"{origin}/mcp,{origin}/api",
        "ATLAS_AUTH_API_KEY_INTROSPECTION_URL": f"{origin}/api/auth/api-key/verify",
        "ATLAS_AUTH_MEMBERSHIP_URL": f"{origin}/api/auth/membership",
        "CORS_ORIGINS": json.dumps([origin]),
    }
    values.update(overrides)
    return SimpleNamespace(
        ATLAS_API_SETTINGS=json.dumps(values),
        HYPERDRIVE=SimpleNamespace(
            host=f"{label}.hyperdrive.local",
            port="5432",
            user="operator",
            password="private-hyperdrive-password",
            database="atlas",
        ),
    )


def headers(label, actor):
    return {
        "x-atlas-internal-secret": f"private-{label}-internal-secret",
        "x-atlas-actor-id": actor,
        "x-atlas-actor-email": f"{actor}@example.com",
        "origin": f"https://{label}.example.com",
    }


@pytest.mark.asyncio
async def test_real_health_and_private_routes_keep_auth_and_cors(monkeypatch):
    hosted = module()
    env = environment()
    app, count = hosted.create_hosted_application(env)
    assert count > 0

    async def forbidden_connect(**kwargs):
        pytest.fail("Health or unauthenticated requests reached the database")

    monkeypatch.setattr(hosted, "connect_database", forbidden_connect)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://reader.example.com"
    ) as client:
        response = await client.get(
            "/health", headers={"origin": "https://reader.example.com"}
        )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert response.headers["cache-control"] == "no-store"
        assert (
            response.headers["access-control-allow-origin"]
            == "https://reader.example.com"
        )
        assert response.headers["x-request-id"]
        for request_headers in (
            {},
            {"x-atlas-actor-id": "forged"},
            headers("wrong", "forged"),
        ):
            response = await client.get("/api/lists", headers=request_headers)
            assert response.status_code == 401
            assert (
                "oauth-protected-resource/mcp" in response.headers["www-authenticate"]
            )


@pytest.mark.asyncio
async def test_concurrent_authenticated_readers_own_settings_and_connections(
    monkeypatch,
):
    hosted = module()
    from atlas.platform.config import get_settings
    from atlas.platform.hosted_runtime import current_hosted_runtime

    opened = []
    barrier = asyncio.Barrier(8)

    class Connection:
        def __init__(self, host):
            self.host = host
            self.closed = False
            self.parameters = None

        async def execute(self, sql, parameters):
            await barrier.wait()
            assert get_settings().auth_jwt_issuer.startswith(
                "https://" + self.host.split(".")[0] + ".example.com/"
            )
            self.parameters = parameters
            return self

        async def fetchall(self):
            return []

        async def close(self):
            self.closed = True

        def is_closed(self):
            return self.closed

    async def connect(**kwargs):
        assert kwargs["password"] == "private-hyperdrive-password"
        assert kwargs["port"] == 5432
        connection = Connection(kwargs["host"])
        opened.append(connection)
        return connection

    monkeypatch.setattr(hosted, "connect_database", connect)
    apps = {
        label: hosted.create_hosted_application(environment(label))[0]
        for label in ("first", "second")
    }

    async def read(index):
        label = "first" if index % 2 == 0 else "second"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=apps[label]),
            base_url=f"https://{label}.example.com",
        ) as client:
            response = await client.get(
                "/api/lists", headers=headers(label, f"actor-{index}")
            )
        assert response.status_code == 200
        assert response.json() == []
        assert (
            response.headers["access-control-allow-origin"]
            == f"https://{label}.example.com"
        )
        assert current_hosted_runtime() is None

    async with asyncio.timeout(10):
        await asyncio.gather(*(read(index) for index in range(8)))
    assert len(opened) == 8
    assert len({id(connection) for connection in opened}) == 8
    assert all(connection.closed for connection in opened)
    assert sorted(connection.parameters[0] for connection in opened) == [
        f"actor-{i}" for i in range(8)
    ]
    assert current_hosted_runtime() is None


def test_lifespan_does_not_migrate_or_start_background_workers(monkeypatch):
    from starlette.testclient import TestClient

    app, _ = module().create_hosted_application(environment())

    async def forbidden(*args, **kwargs):
        pytest.fail("Hosted HTTP ran a process-owned startup job")

    for path in (
        "atlas.main.init_db",
        "atlas.domains.discovery.worker.start_job_worker",
        "atlas.domains.firehose.delivery_worker.start_delivery_worker",
    ):
        monkeypatch.setattr(path, forbidden)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200


@pytest.mark.asyncio
async def test_mcp_mount_owns_fresh_servers_and_preserves_bearer_guard(monkeypatch):
    hosted = module()
    app, _ = hosted.create_hosted_application(environment())
    from atlas.platform.mcp import server as mcp_server

    servers = []
    original = mcp_server.build_mcp

    def build():
        instance = original()
        servers.append(instance)
        return instance

    def forbidden_singleton():
        pytest.fail("Hosted MCP reused the process server")

    monkeypatch.setattr(mcp_server, "build_mcp", build)
    monkeypatch.setattr(mcp_server, "get_mcp", forbidden_singleton)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://reader.example.com"
    ) as client:
        responses = await asyncio.gather(client.post("/mcp"), client.post("/mcp/"))
    assert [response.status_code for response in responses] == [401, 401]
    assert len(servers) == 2
    assert servers[0] is not servers[1]
    assert servers[0].session_manager is not servers[1].session_manager


@pytest.mark.asyncio
async def test_evaluation_prefix_is_explicit_and_boundary_limited():
    hosted = module()
    for enabled in (False, True):
        app, _ = hosted.create_hosted_application(
            environment(), strip_evaluation_prefix=enabled
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="https://reader.example.com",
        ) as client:
            assert (await client.get("/atlas/health")).status_code == (
                200 if enabled else 404
            )
            assert (await client.get("/atlas-extra/health")).status_code == 404
            assert (await client.get("/health")).status_code == 200


def test_settings_ignore_ambient_process_secrets_and_accept_field_names(monkeypatch):
    monkeypatch.setenv("ATLAS_AUTH_INTERNAL_SECRET", "ambient-private-secret")
    monkeypatch.setenv("ATLAS_MULTI_USER", "false")
    monkeypatch.setenv("ENVIRONMENT", "dev")
    env = environment()
    values = json.loads(env.ATLAS_API_SETTINGS)
    values["auth_internal_secret"] = values.pop("ATLAS_AUTH_INTERNAL_SECRET")
    env.ATLAS_API_SETTINGS = json.dumps(values)
    assert module().create_hosted_application(env)[1] > 0
    del values["auth_internal_secret"]
    env.ATLAS_API_SETTINGS = json.dumps(values)
    with pytest.raises(RuntimeError, match="configuration") as error:
        module().create_hosted_application(env)
    assert "ambient-private-secret" not in str(error.value)


@pytest.mark.parametrize(
    "changes",
    [
        {"ENVIRONMENT": "dev"},
        {"DATABASE_BACKEND": "sqlite", "DATABASE_URL": "sqlite:///private-secret.db"},
        {"DATABASE_URL": "private-secret-invalid-url"},
        {"ATLAS_MULTI_USER": "false"},
        {"ATLAS_AUTH_INTERNAL_SECRET": ""},
        {"ATLAS_AUTH_JWT_AUDIENCES": "https://wrong.example.com/mcp"},
        {"CORS_ORIGINS": "private-secret-not-json"},
        {"CORS_ORIGINS": '["*"]'},
        {"CORS_ORIGINS": '"private-secret-not-list"'},
        {"auth_internal_secret": "private-secret-conflicting-alias"},
    ],
)
def test_invalid_production_configuration_is_sanitized(changes):
    with pytest.raises(RuntimeError, match="configuration") as error:
        module().create_hosted_application(environment(**changes))
    assert "private-secret" not in str(error.value)
    assert error.value.__suppress_context__


@pytest.mark.parametrize(
    "settings", [None, "private-secret-json", "[]", '{"ENVIRONMENT":null}']
)
def test_missing_or_malformed_json_does_not_disclose_values(settings):
    env = environment()
    env.ATLAS_API_SETTINGS = settings
    with pytest.raises(RuntimeError, match="configuration") as error:
        module().create_hosted_application(env)
    assert "private-secret" not in str(error.value)


def test_missing_and_invalid_hyperdrive_fail_without_disclosing_binding():
    for binding in (
        None,
        SimpleNamespace(password="private-secret"),
        environment().HYPERDRIVE,
    ):
        env = environment()
        env.HYPERDRIVE = binding
        if binding is not None and hasattr(binding, "port"):
            binding.port = "private-secret-invalid-port"
        with pytest.raises(RuntimeError, match="configuration") as error:
            module().create_hosted_application(env)
        assert "private-secret" not in str(error.value)


@pytest.mark.asyncio
async def test_runtime_spans_streaming_response_and_closes_unreleased_connection(
    monkeypatch,
):
    hosted = module()
    hosted.create_hosted_application(environment())
    from atlas.main import create_app
    from atlas.platform.config import get_settings
    from atlas.platform.database import get_db_connection
    from atlas.platform.hosted_runtime import current_hosted_runtime
    from starlette.responses import StreamingResponse

    connection = SimpleNamespace(closed=False)

    async def close():
        connection.closed = True

    connection.close = close
    connection.is_closed = lambda: connection.closed

    async def connect(**kwargs):
        return connection

    def factory(**kwargs):
        app = create_app(**kwargs)

        @app.get("/stream-test")
        async def stream_test():
            async def chunks():
                settings = get_settings()
                await get_db_connection(settings.database_url, backend="postgres")
                yield b"first:"
                await asyncio.sleep(0)
                assert not connection.closed
                assert current_hosted_runtime() is not None
                yield get_settings().environment.encode()

            return StreamingResponse(chunks())

        return app

    monkeypatch.setattr(hosted, "connect_database", connect)
    monkeypatch.setattr("atlas.main.create_app", factory)
    app, _ = hosted.create_hosted_application(environment())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://reader.example.com"
    ) as client:
        response = await client.get("/stream-test")
    assert response.text == "first:production"
    assert connection.closed
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_cancellation_closes_every_connection_even_when_one_close_fails(
    monkeypatch,
):
    hosted = module()
    hosted.create_hosted_application(environment())
    from atlas.main import create_app
    from atlas.platform.config import get_settings
    from atlas.platform.database import get_db_connection
    from atlas.platform.hosted_runtime import current_hosted_runtime

    ready = asyncio.Event()
    closed = []
    opened = []

    async def connect(**kwargs):
        index = len(opened)

        async def close():
            closed.append(index)
            if index == 1:
                raise RuntimeError("Close failed")

        connection = SimpleNamespace(close=close, is_closed=lambda: False)
        opened.append(connection)
        return connection

    def factory(**kwargs):
        app = create_app(**kwargs)

        @app.get("/cancel-test")
        async def cancel_test():
            settings = get_settings()
            await get_db_connection(settings.database_url, backend="postgres")
            await get_db_connection(settings.database_url, backend="postgres")
            ready.set()
            await asyncio.Event().wait()

        return app

    monkeypatch.setattr(hosted, "connect_database", connect)
    monkeypatch.setattr("atlas.main.create_app", factory)
    app, _ = hosted.create_hosted_application(environment())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://reader.example.com"
    ) as client:
        task = asyncio.create_task(client.get("/cancel-test"))
        await asyncio.wait_for(ready.wait(), timeout=5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError) as error:
            await task
        assert isinstance(error.value.__cause__, RuntimeError)
        assert str(error.value.__cause__) == "Close failed"
        assert task.cancelled()
    assert sorted(closed) == [0, 1]
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_application_owns_explicit_firehose_wake(monkeypatch):
    from atlas.platform.hosted_runtime import current_hosted_runtime
    import atlas.main

    wake = object()
    captured = []

    async def app(scope, receive, send):
        captured.append(current_hosted_runtime().firehose_wake)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    app.routes = []
    monkeypatch.setattr(atlas.main, "create_app", lambda **kwargs: app)
    hosted, _ = module().create_hosted_application(environment(), firehose_wake=wake)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=hosted), base_url="https://reader.example.com"
    ) as client:
        assert (await client.get("/health")).status_code == 200
    assert captured == [wake]
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_alarm_factory_uses_explicit_configuration_and_owned_connection(
    monkeypatch,
):
    import hosted_jobs

    hosted = module()
    opened = []

    async def connect(**kwargs):
        connection = SimpleNamespace(close=AsyncMock())
        opened.append((kwargs, connection))
        return connection

    from unittest.mock import AsyncMock

    monkeypatch.setattr(hosted, "connect_database", connect)
    storage = SimpleNamespace(setAlarm=AsyncMock())
    adapter = hosted_jobs.create_firehose_alarm(environment("alarm"), storage)
    assert not opened
    assert adapter.runtime.firehose_wake is adapter
    runtime = adapter.runtime
    conn = await runtime.connect(runtime.settings.database_url, backend="postgres")
    assert opened[0][0]["host"] == "alarm.hyperdrive.local"
    await conn.close()
    conn.close.assert_awaited_once()
    with pytest.raises(RuntimeError, match="configuration mismatch"):
        await runtime.connect("postgresql://wrong/db", backend="postgres")
    with pytest.raises(RuntimeError, match="configuration mismatch"):
        await runtime.connect(runtime.settings.database_url, backend="sqlite")
    assert len(opened) == 1


def test_alarm_factory_redacts_invalid_configuration():
    import hosted_jobs

    env = environment(FIREHOSE_DELIVERY_WORKER_LEASE_SECONDS="private-invalid-secret")
    with pytest.raises(
        RuntimeError, match="^Invalid hosted API configuration.$"
    ) as error:
        hosted_jobs.create_firehose_alarm(env, SimpleNamespace())
    assert "private-invalid-secret" not in str(error.value)
