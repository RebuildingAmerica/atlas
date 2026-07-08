"""Anonymous rate-limit tests for proxy and forwarded-address identity."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from tests.support.anonymous_rate_limit import READ_PATH, _client, _settings


@pytest.mark.asyncio
async def test_unsigned_proxy_client_headers_cannot_change_limit_identity(db_url: str) -> None:
    """Attackers should not evade limits by spoofing Atlas proxy identity headers."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(READ_PATH, headers={"X-Atlas-Client-IP": "203.0.113.20"})
        blocked = await client.get(READ_PATH, headers={"X-Atlas-Client-IP": "198.51.100.30"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_invalid_signed_proxy_client_ip_falls_back_to_direct_client(db_url: str) -> None:
    """A valid proxy secret still needs a parseable client IP before it affects identity."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "not-an-ip",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        blocked = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "also-not-an-ip",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_signed_proxy_secret_without_client_ip_falls_back_to_direct_client(
    db_url: str,
) -> None:
    """A proxy signature without a client IP should not create a trusted bucket."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={"X-Atlas-Proxy-Secret": "internal-test-secret"},
        )
        blocked = await client.get(
            READ_PATH,
            headers={"X-Atlas-Proxy-Secret": "internal-test-secret"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_wrong_proxy_secret_does_not_unlock_proxy_identity(db_url: str) -> None:
    """A spoofed proxy secret should behave the same as an unsigned proxy header."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "wrong-secret",
            },
        )
        blocked = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "198.51.100.30",
                "X-Atlas-Proxy-Secret": "wrong-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_forwarded_for_identity_honors_trusted_proxy_hops(db_url: str) -> None:
    """Direct API requests should use the configured forwarded-for hop policy."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        trust_unsigned_forward_headers=True,
    )

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.1"},
        )
        blocked = await client.get(
            READ_PATH,
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.2"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_forwarded_for_zero_trusted_hops_uses_rightmost_address(db_url: str) -> None:
    """A zero-hop policy should use the rightmost forwarded-for address."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        trust_unsigned_forward_headers=True,
        trusted_proxy_hops=0,
    )

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.1"},
        )
        blocked = await client.get(
            READ_PATH,
            headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_malformed_forwarded_for_falls_back_to_direct_client(db_url: str) -> None:
    """Malformed forwarded-for values should not create attacker-controlled buckets."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(READ_PATH, headers={"X-Forwarded-For": "garbage"})
        blocked = await client.get(READ_PATH, headers={"X-Forwarded-For": "more garbage"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_unsigned_forwarded_for_is_ignored_by_default(db_url: str) -> None:
    """Direct traffic should not get attacker-controlled identities from XFF."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={"X-Forwarded-For": "198.51.100.10, 10.0.0.1"},
        )
        blocked = await client.get(
            READ_PATH,
            headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.2"},
        )

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_signed_proxy_client_headers_partition_proxied_clients(db_url: str) -> None:
    """The app proxy should let the API rate-limit real proxied client IPs."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        second = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "198.51.100.30",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK


@pytest.mark.asyncio
async def test_signed_edge_origin_secret_partitions_proxied_clients(db_url: str) -> None:
    """Cloudflare edge headers should be trusted only with the edge origin secret."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        edge_origin_secret="edge-test-secret",
    )

    async for client in _client(settings):
        first = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "edge-test-secret",
            },
        )
        second = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "198.51.100.30",
                "X-Atlas-Proxy-Secret": "edge-test-secret",
            },
        )

    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK


@pytest.mark.asyncio
async def test_signed_proxy_client_header_normalizes_ipv6_and_ipv4_ports(db_url: str) -> None:
    """Signed proxy client IPs should normalize common proxy header forms."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    async for client in _client(settings):
        ipv6_first = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "[2001:db8::1]",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        ipv6_blocked = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "2001:db8::1",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        port_first = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "203.0.113.20:4321",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )
        port_blocked = await client.get(
            READ_PATH,
            headers={
                "X-Atlas-Client-IP": "203.0.113.20",
                "X-Atlas-Proxy-Secret": "internal-test-secret",
            },
        )

    assert ipv6_first.status_code == HTTPStatus.OK
    assert ipv6_blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert port_first.status_code == HTTPStatus.OK
    assert port_blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
