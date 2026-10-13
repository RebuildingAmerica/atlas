"""Hosted visitors use their own HTTP transport, never native Workers TLS."""

from typing import Never

import httpx
import pytest

from atlas.platform.config import Settings
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime


@pytest.mark.asyncio
async def test_hosted_http_client_uses_request_owned_transport() -> None:
    from atlas.platform.outbound_http import outbound_http_client

    async def connect(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError

    clients = []

    def transport() -> httpx.MockTransport:
        value = httpx.MockTransport(
            lambda request: httpx.Response(200, text=request.headers["x-user"])
        )
        clients.append(value)
        return value

    with bind_hosted_runtime(HostedRuntime(Settings(), connect, http_transport_factory=transport)):
        async with outbound_http_client() as first, outbound_http_client() as second:
            assert (await first.get("https://example.org", headers={"x-user": "one"})).text == "one"
            assert (
                await second.get("https://example.org", headers={"x-user": "two"})
            ).text == "two"
    assert clients[0] is not clients[1]


def test_unconfigured_hosted_http_fails_explicitly() -> None:
    from atlas.platform.outbound_http import outbound_http_client

    async def connect(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError

    with (
        bind_hosted_runtime(HostedRuntime(Settings(), connect)),
        pytest.raises(RuntimeError, match="HTTP transport"),
    ):
        outbound_http_client()


@pytest.mark.asyncio
async def test_native_http_preserves_explicit_transport() -> None:
    from atlas.platform.outbound_http import outbound_http_client

    async with outbound_http_client(
        transport=httpx.MockTransport(lambda _request: httpx.Response(204)), timeout=1.0
    ) as client:
        assert (await client.get("https://example.org")).status_code == 204
