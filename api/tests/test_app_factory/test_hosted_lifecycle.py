"""Hosted requests preserve API middleware and own independent MCP lifetimes."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from starlette.responses import JSONResponse

from atlas.main import create_app
from atlas.platform.config import Settings, get_settings
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime, current_hosted_runtime
from atlas.platform.mcp.server import build_mcp, get_mcp_asgi_app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI
    from starlette.types import Receive, Scope, Send


async def unused_database(_url: str, *, backend: str | None = None) -> Any:
    """These transport probes must never need a database."""
    pytest.fail(f"Unexpected database connection: {backend}")


@pytest.mark.asyncio
async def test_hosted_factory_replaces_startup_but_preserves_outer_middleware(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A health/MCP request must not migrate or launch process-owned workers."""

    async def forbidden_start(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Hosted HTTP must not run process startup")

    for name in (
        "atlas.main.init_db",
        "atlas.domains.discovery.worker.start_job_worker",
        "atlas.domains.firehose.delivery_worker.start_delivery_worker",
    ):
        monkeypatch.setattr(name, forbidden_start)
    monkeypatch.setattr("atlas.main.get_mcp_asgi_app", forbidden_start)
    phases: list[str] = []

    @asynccontextmanager
    async def hosted_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        phases.append("entered")
        yield
        phases.append("exited")

    async def mounted(scope: Scope, receive: Receive, send: Send) -> None:
        await JSONResponse({"mounted": True})(scope, receive, send)

    settings = Settings(
        _env_file=None,
        multi_user=False,
        managed=False,
        cors_origins=["https://reader.example.com"],
        discovery_job_worker_enabled=True,
        firehose_delivery_worker_enabled=True,
    )
    with bind_hosted_runtime(HostedRuntime(settings, unused_database)):
        app = create_app(lifespan_override=hosted_lifespan, mcp_asgi_app=mounted)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000"
            ) as client,
        ):
            health = await client.get("/health")
            assert health.json() == {"status": "ok"}
            assert health.headers["cache-control"] == "no-store"
            for path in ("/mcp", "/mcp/"):
                response = await client.post(path, headers={"origin": "https://reader.example.com"})
                assert response.json() == {"mounted": True}
                assert (
                    response.headers["access-control-allow-origin"] == "https://reader.example.com"
                )
                assert response.headers["x-request-id"]
        assert phases == ["entered", "exited"]
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_concurrent_request_owned_mcp_servers_keep_runtime_and_lifetimes_separate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ending one real MCP session must not cancel or reconfigure another request."""

    def forbidden_singleton() -> None:
        pytest.fail("Request-owned MCP must not use the process singleton")

    monkeypatch.setattr("atlas.platform.mcp.server.get_mcp", forbidden_singleton)
    ready = [asyncio.Event(), asyncio.Event()]
    first_finished = asyncio.Event()

    async def run_request(index: int) -> str:
        label = ("first", "second")[index]
        settings = Settings(
            _env_file=None,
            multi_user=False,
            managed=False,
            auth_jwt_audience=[],
            cors_origins=[f"https://{label}.example.com"],
        )
        with bind_hosted_runtime(HostedRuntime(settings, unused_database)):
            server = build_mcp()

            @server.tool()
            async def runtime_probe() -> str:
                ready[index].set()
                await ready[1 - index].wait()
                if index == 1:
                    await first_finished.wait()
                return get_settings().cors_origins[0]

            transport = get_mcp_asgi_app(server=server)
            async with (
                server.session_manager.run(),
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=transport), base_url="http://localhost:8000"
                ) as client,
            ):
                response = await client.post(
                    "/",
                    headers={
                        "accept": "application/json, text/event-stream",
                        "origin": f"https://{label}.example.com",
                    },
                    json={
                        "jsonrpc": "2.0",
                        "id": index + 1,
                        "method": "tools/call",
                        "params": {"name": "runtime_probe", "arguments": {}},
                    },
                )
                assert response.status_code == 200, response.text
                assert (
                    response.headers["access-control-allow-origin"]
                    == f"https://{label}.example.com"
                )
                result = response.json()["result"]["content"][0]["text"]
            if index == 0:
                first_finished.set()
            return str(result)

    async with asyncio.timeout(10):
        results = await asyncio.gather(run_request(0), run_request(1))
    assert results == ["https://first.example.com", "https://second.example.com"]
    assert current_hosted_runtime() is None
