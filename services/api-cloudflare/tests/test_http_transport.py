"""Account callbacks use Workers HTTPS and release every request-owned stream."""

import asyncio
import importlib
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
