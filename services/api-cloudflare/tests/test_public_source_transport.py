"""Provider streaming and cancellation preserve bounded source evidence reads."""

import asyncio
import importlib
import sys
from types import SimpleNamespace

import pytest


class Reader:
    def __init__(self, chunks=(), *, read_error=None, cancel_error=None):
        self.chunks = iter(chunks)
        self.read_error = read_error
        self.cancel_error = cancel_error
        self.cancelled = False
        self.released = False

    async def read(self):
        if self.read_error:
            raise self.read_error
        value = next(self.chunks, None)
        return SimpleNamespace(
            done=value is None,
            value=SimpleNamespace(to_py=lambda: memoryview(value)),
        )

    async def cancel(self):
        self.cancelled = True
        if self.cancel_error:
            raise self.cancel_error

    def releaseLock(self):
        self.released = True


def provider(monkeypatch, *, reader=None, status=200, headers=None, pending=False):
    calls = []
    controllers = []
    started = asyncio.Event()

    class Controller:
        def __init__(self):
            self.signal = object()
            self.aborted = False
            controllers.append(self)

        def abort(self):
            self.aborted = True

    async def fetch(url, **options):
        calls.append((url, options))
        started.set()
        if pending:
            await asyncio.Event().wait()
        return SimpleNamespace(
            status=status,
            headers=headers or {},
            body=None if reader is None else SimpleNamespace(getReader=lambda: reader),
        )

    monkeypatch.setitem(sys.modules, "workers", SimpleNamespace(fetch=fetch))
    monkeypatch.setitem(
        sys.modules, "js", SimpleNamespace(AbortController=SimpleNamespace(new=Controller))
    )
    module = importlib.import_module("public_source_transport")
    return module.workers_public_source_fetch, calls, controllers, started


@pytest.mark.asyncio
async def test_public_fetch_streams_decoded_bytes_and_releases_request_owned_resources(monkeypatch):
    reader = Reader([b"source ", b"evidence"])
    fetcher, calls, controllers, _ = provider(
        monkeypatch, reader=reader, headers={"Content-Type": "text/html"}
    )
    async with fetcher("https://example.com/", {"User-Agent": "AtlasBot"}) as response:
        assert response.status_code == 200
        assert response.headers == {"Content-Type": "text/html"}
        assert b"".join([chunk async for chunk in response.body]) == b"source evidence"
        assert not controllers[0].aborted
    assert calls == [
        (
            "https://example.com/",
            {
                "headers": {"User-Agent": "AtlasBot"},
                "redirect": "manual",
                "signal": controllers[0].signal,
            },
        )
    ]
    assert reader.cancelled and reader.released and controllers[0].aborted


@pytest.mark.asyncio
async def test_empty_redirect_closes_without_following_it(monkeypatch):
    fetcher, calls, controllers, _ = provider(
        monkeypatch, status=302, headers={"Location": "http://127.0.0.1/"}
    )
    async with fetcher("https://example.com/", {}) as response:
        assert response.status_code == 302
        assert [chunk async for chunk in response.body] == []
    assert len(calls) == 1
    assert controllers[0].aborted


@pytest.mark.asyncio
async def test_body_failure_preserves_failure_and_releases_stream(monkeypatch):
    reader = Reader(read_error=ValueError("bad body"), cancel_error=OSError("closed"))
    fetcher, _, controllers, _ = provider(monkeypatch, reader=reader)
    with pytest.raises(ValueError, match="bad body") as error:
        async with fetcher("https://example.com/", {}) as response:
            await anext(response.body)
    assert isinstance(error.value.__cause__, OSError)
    assert reader.cancelled and reader.released and controllers[0].aborted


@pytest.mark.asyncio
async def test_cancelled_pending_fetch_aborts_before_any_response(monkeypatch):
    fetcher, _, controllers, started = provider(monkeypatch, pending=True)

    async def read():
        async with fetcher("https://example.com/", {}):
            pytest.fail("Pending response unexpectedly opened")

    task = asyncio.create_task(read())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert controllers[0].aborted


@pytest.mark.asyncio
async def test_bounded_core_reader_cancels_oversized_provider_stream(monkeypatch):
    from atlas.domains.discovery.pipeline.source_http import fetch_public_source

    reader = Reader([b"small", b"too much"])
    fetcher, calls, controllers, _ = provider(monkeypatch, reader=reader)
    with pytest.raises(ValueError, match="size limit"):
        await fetch_public_source("https://example.com/", fetcher, max_bytes=5)
    assert len(calls) == 1
    assert reader.cancelled and reader.released and controllers[0].aborted


@pytest.mark.asyncio
async def test_body_cleanup_failure_is_explicit_and_still_aborts(monkeypatch):
    reader = Reader(cancel_error=OSError("cleanup failed"))
    fetcher, _, controllers, _ = provider(monkeypatch, reader=reader)
    with pytest.raises(OSError, match="cleanup failed"):
        async with fetcher("https://example.com/", {}):
            pass
    assert reader.released and controllers[0].aborted


@pytest.mark.asyncio
async def test_protected_probe_uses_fixed_targets_and_does_not_return_source_body(monkeypatch):
    import httpx

    reader = Reader([b"Example Domain: source evidence"])
    _, calls, controllers, _ = provider(monkeypatch, reader=reader)
    app = importlib.import_module("app_probe").app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://protected.example.com"
    ) as client:
        response = await client.get("/public-source/https")
        assert response.status_code == 200
        data = response.json()
        assert data["outcome"] == "received"
        assert data["example_domain"] is True
        assert data["bytes"] == 31
        assert "source evidence" not in response.text
        assert (await client.get("/public-source/arbitrary-target")).status_code == 422
    assert [url for url, _ in calls] == ["https://example.com/"]
    assert controllers[0].aborted and reader.released
