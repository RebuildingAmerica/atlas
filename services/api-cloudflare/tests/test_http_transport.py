"""Account callbacks use Workers HTTPS and release every request-owned stream."""

import asyncio
import importlib
import json
import sys
from types import SimpleNamespace

import httpx
import pytest


def setup_fetch(monkeypatch, mode="ok"):
    calls, controllers, readers = [], [], []

    class Controller:
        signal = object()

        def __init__(self):
            self.aborted = False
            controllers.append(self)

        def abort(self):
            self.aborted = True

    class Reader:
        def __init__(self):
            self.chunks = iter([b'{"role":', b'"owner"}'])
            self.cancelled = False
            self.released = False
            readers.append(self)

        async def read(self):
            if mode == "read-timeout":
                await asyncio.sleep(1)
            chunk = next(self.chunks, None)
            return SimpleNamespace(
                done=chunk is None, value=SimpleNamespace(to_py=lambda: chunk)
            )

        async def cancel(self):
            self.cancelled = True

        def releaseLock(self):
            self.released = True

    async def fetch(url, **kwargs):
        calls.append((url, kwargs))
        if mode == "network":
            raise OSError("private provider message")
        if mode == "connect-timeout":
            await asyncio.sleep(1)
        if mode == "redirect" and len(calls) == 1:
            return SimpleNamespace(
                status=302,
                headers={"location": "https://other.example.org/callback"},
                body=None,
            )
        return SimpleNamespace(
            status=200,
            headers=httpx.Headers({"content-type": "application/json"}),
            body=SimpleNamespace(getReader=Reader),
        )

    monkeypatch.setitem(sys.modules, "workers", SimpleNamespace(fetch=fetch))
    monkeypatch.setitem(
        sys.modules,
        "js",
        SimpleNamespace(AbortController=SimpleNamespace(new=Controller)),
    )
    return (
        importlib.import_module("http_transport").WorkersHttpTransport,
        calls,
        controllers,
        readers,
    )


@pytest.mark.asyncio
async def test_callback_access_is_limited_to_the_configured_origin(monkeypatch):
    _, calls, _, _ = setup_fetch(monkeypatch)
    module = importlib.import_module("http_transport")
    factory = module.workers_http_transport_factory(
        SimpleNamespace(
            ATLAS_API_SETTINGS=json.dumps(
                {
                    "ATLAS_CALLBACK_ACCESS_ORIGIN": "https://candidate.example.org",
                    "ATLAS_CALLBACK_ACCESS_CLIENT_ID": "fixture-client",
                    "ATLAS_CALLBACK_ACCESS_CLIENT_SECRET": "fixture-secret",
                }
            )
        )
    )
    async with httpx.AsyncClient(transport=factory()) as client:
        await client.get(
            "https://candidate.example.org/api/auth/internal/memberships/org/members/user"
        )
        await client.get(
            "https://other.example.org/api/auth/internal/memberships/org/members/user"
        )
    assert calls[0][1]["headers"]["CF-Access-Client-Id"] == "fixture-client"
    assert calls[0][1]["headers"]["CF-Access-Client-Secret"] == "fixture-secret"
    assert "CF-Access-Client-Secret" not in calls[1][1]["headers"]
    assert factory() is not factory()


@pytest.mark.asyncio
async def test_https_preserves_request_and_streams_response(monkeypatch):
    transport, calls, controllers, readers = setup_fetch(monkeypatch)
    async with httpx.AsyncClient(transport=transport()) as client:
        response = await client.post(
            "https://example.org/callback", content=b"body", headers={"x-owner": "one"}
        )
    assert response.json() == {"role": "owner"}
    assert calls[0][1]["body"] == b"body"
    assert calls[0][1]["headers"]["x-owner"] == "one"
    assert calls[0][1]["redirect"] == "manual"
    assert controllers[0].aborted and readers[0].cancelled and readers[0].released


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode,error",
    [
        ("network", httpx.ConnectError),
        ("connect-timeout", httpx.ConnectTimeout),
        ("read-timeout", httpx.ReadTimeout),
    ],
)
async def test_failures_close_resources_and_preserve_httpx_contract(
    monkeypatch, mode, error
):
    transport, _, controllers, readers = setup_fetch(monkeypatch, mode)
    async with httpx.AsyncClient(transport=transport(), timeout=0.001) as client:
        with pytest.raises(error) as result:
            await client.get("https://example.org/callback")
    assert "private provider message" not in str(result.value)
    assert controllers[0].aborted
    assert all(reader.cancelled and reader.released for reader in readers)


@pytest.mark.asyncio
async def test_closing_partial_response_releases_stream(monkeypatch):
    transport, _, controllers, readers = setup_fetch(monkeypatch)
    async with httpx.AsyncClient(transport=transport()) as client:
        async with client.stream("GET", "https://example.org/callback") as response:
            assert await anext(response.aiter_bytes()) == b'{"role":'
    assert controllers[0].aborted and readers[0].cancelled and readers[0].released


@pytest.mark.asyncio
async def test_callback_redirect_never_carries_access_proof(monkeypatch):
    _, calls, _, _ = setup_fetch(monkeypatch, "redirect")
    module = importlib.import_module("http_transport")
    factory = module.workers_http_transport_factory(
        SimpleNamespace(
            ATLAS_API_SETTINGS=json.dumps(
                {
                    "ATLAS_CALLBACK_ACCESS_ORIGIN": "https://candidate.example.org",
                    "ATLAS_CALLBACK_ACCESS_CLIENT_ID": "fixture-client",
                    "ATLAS_CALLBACK_ACCESS_CLIENT_SECRET": "fixture-secret",
                }
            )
        )
    )
    async with httpx.AsyncClient(transport=factory(), follow_redirects=True) as client:
        response = await client.get("https://candidate.example.org/callback")
    assert response.status_code == 200
    assert calls[0][1]["headers"]["CF-Access-Client-Secret"] == "fixture-secret"
    assert "CF-Access-Client-Secret" not in calls[1][1]["headers"]
    assert "cf-access-client-secret" not in response.request.headers


@pytest.mark.parametrize(
    "origin",
    [
        None,
        "http://candidate.example.org",
        "https://user:secret@candidate.example.org",
        "https://candidate.example.org/path",
        "https://candidate.example.org?private=1",
    ],
)
def test_invalid_callback_access_configuration_is_rejected(origin):
    module = importlib.import_module("http_transport")
    with pytest.raises(ValueError):
        module.workers_http_transport_factory(
            SimpleNamespace(
                ATLAS_API_SETTINGS=json.dumps(
                    {
                        "ATLAS_CALLBACK_ACCESS_ORIGIN": origin,
                        "ATLAS_CALLBACK_ACCESS_CLIENT_ID": "fixture-client",
                        "ATLAS_CALLBACK_ACCESS_CLIENT_SECRET": "fixture-secret",
                    }
                )
            )
        )
