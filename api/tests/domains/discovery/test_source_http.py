"""Public-source responses stay bounded and each redirect gets a fresh request."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import pytest

from atlas.domains.discovery.pipeline.source_http import PublicSourceResponse

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@pytest.mark.asyncio
async def test_public_redirect_reads_bounded_body_and_closes_every_response() -> None:
    from atlas.domains.discovery.pipeline.source_http import (
        PublicSourceResponse,
        fetch_public_source,
    )

    requests, closed = [], []

    @asynccontextmanager
    async def fetch(url, headers) -> AsyncIterator[PublicSourceResponse]:
        requests.append((url, headers))

        async def body() -> AsyncIterator[bytes]:
            yield b"Housing "
            yield b"Trust"

        try:
            yield PublicSourceResponse(
                302 if len(requests) == 1 else 200,
                {"Location": "/story", "Set-Cookie": "private=value"}
                if len(requests) == 1
                else {
                    "Content-Type": "text/html",
                    "Content-Length": "13",
                    "Content-Encoding": "gzip",
                },
                body(),
            )
        finally:
            closed.append(url)

    document = await fetch_public_source("https://example.org/start", fetch)
    assert document.text == "Housing Trust"
    assert document.url == "https://example.org/story"
    assert len(closed) == 2
    assert requests[1][0] == "https://example.org/story"
    assert all(
        set(headers) == {"User-Agent", "Accept", "Accept-Language"} for _, headers in requests
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "destination",
    [
        "http://127.0.0.1",
        "http://１２７。０。０。１",  # noqa: RUF001 - exercise IDNA address disguise
        "http://@example.org",
        "http://224.0.0.1",
        "http://[2002:7f00:1::]",
        "http://[64:ff9b::7f00:1]",
        "http://[::ffff:127.0.0.1]",
        "http://169.254.169.254",
        "http://[::1]",
        "https://user:secret@example.org",
        "file:///etc/passwd",
        "http://localhost.",
        "http://2130706433",
        "http://0177.0.0.1",
        "http://0x7f.0.0.1",
        "https://example.org\\@127.0.0.1",
        "https://example.org\n.evil.org",
    ],
)
async def test_unsafe_redirect_is_rejected_before_next_fetch(destination) -> None:
    from atlas.domains.discovery.pipeline.source_http import (
        PublicSourceResponse,
        fetch_public_source,
    )

    requests, closed = [], []

    @asynccontextmanager
    async def fetch(url, _headers) -> AsyncIterator[PublicSourceResponse]:
        requests.append(url)

        async def body() -> AsyncIterator[bytes]:
            yield b""

        try:
            yield PublicSourceResponse(302, {"location": destination}, body())
        finally:
            closed.append(url)

    with pytest.raises(ValueError, match=r"public|Public|invalid"):
        await fetch_public_source("https://example.org", fetch)
    assert requests == closed == ["https://example.org"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("headers", "chunks"),
    [
        ({"Content-Length": "100"}, [b"x"]),
        ({}, [b"123", b"456"]),
        ({"content-length": "invalid"}, [b"x"]),
    ],
)
async def test_oversize_or_invalid_length_response_closes_without_returning_body(
    headers, chunks
) -> None:
    from atlas.domains.discovery.pipeline.source_http import (
        PublicSourceResponse,
        fetch_public_source,
    )

    closed = []

    @asynccontextmanager
    async def fetch(_url, _headers) -> AsyncIterator[PublicSourceResponse]:
        async def body() -> AsyncIterator[bytes]:
            for chunk in chunks:
                yield chunk

        try:
            yield PublicSourceResponse(200, headers, body())
        finally:
            closed.append(True)

    with pytest.raises(ValueError, match=r"public|Public|invalid"):
        await fetch_public_source("https://example.org", fetch, max_bytes=5)
    assert closed == [True]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "headers"), [(302, {}), (301, {"location": "/loop"}), (404, {})]
)
async def test_redirect_loops_missing_locations_and_http_failures_are_explicit(
    status, headers
) -> None:
    import httpx

    from atlas.domains.discovery.pipeline.source_http import (
        PublicSourceResponse,
        fetch_public_source,
    )

    closed = []

    @asynccontextmanager
    async def fetch(_url, _headers) -> AsyncIterator[PublicSourceResponse]:
        async def body() -> AsyncIterator[bytes]:
            yield b""

        try:
            yield PublicSourceResponse(status, headers, body())
        finally:
            closed.append(True)

    with pytest.raises((ValueError, httpx.HTTPStatusError)):
        await fetch_public_source("https://example.org", fetch, max_redirects=1)
    assert len(closed) == (2 if headers else 1)


@pytest.mark.asyncio
async def test_timeout_closes_inflight_body() -> None:
    from atlas.domains.discovery.pipeline.source_http import (
        PublicSourceResponse,
        fetch_public_source,
    )

    closed = []

    @asynccontextmanager
    async def fetch(_url, _headers) -> AsyncIterator[PublicSourceResponse]:
        async def body() -> AsyncIterator[bytes]:
            await asyncio.sleep(10)
            yield b"never"

        try:
            yield PublicSourceResponse(200, {}, body())
        finally:
            closed.append(True)

    with pytest.raises(TimeoutError):
        await fetch_public_source("https://example.org", fetch, timeout=0.01)
    assert closed == [True]


@pytest.mark.asyncio
async def test_hosted_fetchers_are_request_owned_and_used_for_search_and_direct_sources(
    monkeypatch,
) -> None:
    from unittest.mock import AsyncMock

    import httpx
    import trafilatura

    from atlas.domains.discovery.pipeline.direct_sources import fetch_direct_source
    from atlas.domains.discovery.pipeline.source_fetcher import _extract_page_text
    from atlas.platform.config import Settings
    from atlas.platform.hosted_runtime import (
        HostedRuntime,
        bind_hosted_runtime,
        current_hosted_runtime,
    )

    monkeypatch.setattr(trafilatura, "extract", lambda text, **_kwargs: text)
    entered = 0
    ready = asyncio.Event()
    called, closed = [], []

    async def run(label, direct) -> str:
        @asynccontextmanager
        async def fetch(url, headers) -> AsyncIterator[PublicSourceResponse]:
            nonlocal entered
            called.append((label, url, headers))
            entered += 1
            if entered == 2:
                ready.set()

            async def body() -> AsyncIterator[bytes]:
                await ready.wait()
                yield label.encode()

            try:
                yield PublicSourceResponse(200, {}, body())
            finally:
                closed.append(label)

        runtime = HostedRuntime(
            Settings(_env_file=None),
            AsyncMock(),
            public_source_fetch=fetch,
            http_transport_factory=lambda: httpx.MockTransport(
                lambda _request: pytest.fail("must use hosted public egress")
            ),
        )
        with bind_hosted_runtime(runtime):
            if direct:
                source = await fetch_direct_source("https://example.org/direct")
                return source.content
            client = AsyncMock()
            client.get.side_effect = AssertionError("must use hosted public egress")
            return await _extract_page_text(client, "https://example.org/search-result")

    assert await asyncio.gather(run("one", False), run("two", True)) == ["one", "two"]
    assert len(called) == 2
    assert sorted(closed) == ["one", "two"]
    assert current_hosted_runtime() is None


@pytest.mark.asyncio
async def test_hosted_source_calls_fail_closed_without_public_fetch_capability() -> None:
    from unittest.mock import AsyncMock

    from atlas.domains.discovery.pipeline.direct_sources import fetch_direct_source
    from atlas.domains.discovery.pipeline.source_fetcher import _extract_page_text
    from atlas.platform.config import Settings
    from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime

    client = AsyncMock()
    with bind_hosted_runtime(HostedRuntime(Settings(_env_file=None), AsyncMock())):
        with pytest.raises(RuntimeError, match="not configured"):
            await fetch_direct_source("https://example.org")
        with pytest.raises(RuntimeError, match="not configured"):
            await _extract_page_text(client, "https://example.org")
    client.get.assert_not_awaited()


@pytest.mark.parametrize(
    "url", ["https://example.org:0", "https://[fe80::1%25en0]", "https://example.org:65536"]
)
def test_ambiguous_destination_ports_and_scopes_are_rejected(url) -> None:
    from atlas.domains.discovery.pipeline.source_http import validate_public_source_url

    with pytest.raises(ValueError, match=r"invalid|Port"):
        validate_public_source_url(url)


@pytest.mark.asyncio
async def test_cancellation_releases_body_without_affecting_another_fetch() -> None:
    from atlas.domains.discovery.pipeline.source_http import fetch_public_source

    started = asyncio.Event()
    closed = []

    @asynccontextmanager
    async def fetch(url, _headers) -> AsyncIterator[PublicSourceResponse]:
        async def body() -> AsyncIterator[bytes]:
            if url.endswith("slow"):
                started.set()
                await asyncio.sleep(10)
            yield b"Public evidence"

        try:
            yield PublicSourceResponse(200, {}, body())
        finally:
            closed.append(url)

    pending = asyncio.create_task(fetch_public_source("https://example.org/slow", fetch))
    await started.wait()
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    result = await fetch_public_source("https://example.org/other", fetch)
    assert result.text == "Public evidence"
    assert closed == ["https://example.org/slow", "https://example.org/other"]


@pytest.mark.parametrize(
    "url",
    [
        "https://[2001:4860:4860::8888]",
        "https://8.8.8.8",
        "https://example.org",
    ],
)
def test_global_destinations_pass_syntax_guard_without_claiming_dns_protection(url) -> None:
    from atlas.domains.discovery.pipeline.source_http import validate_public_source_url

    validate_public_source_url(url)
