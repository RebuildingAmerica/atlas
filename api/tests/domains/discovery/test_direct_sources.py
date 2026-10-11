"""Direct-source transport keeps explicit seeds and rejects local redirects."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

import httpx
import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "file:///tmp/data",
        "https://user:secret@example.org",
        "http://localhost",
        "http://app.local",
        "http://app.internal",
        "http://localhost.",
        "http://127.0.0.1",
        "http://[::1]",
        "http://169.254.169.254",
        "https://",
    ],
)
async def test_private_seeds_are_rejected_before_network(monkeypatch, url) -> None:
    from atlas.domains.discovery.pipeline import direct_sources as direct

    extract = AsyncMock()
    monkeypatch.setattr(direct, "_extract_page_text", extract)
    with pytest.raises(ValueError, match="public"):
        await direct.fetch_direct_source(url)
    extract.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("result", ["Council housing evidence", "", httpx.ConnectError("offline")])
async def test_public_seed_identity_and_empty_or_failed_source(monkeypatch, result) -> None:
    from atlas.domains.discovery.pipeline import direct_sources as direct

    extract = AsyncMock(side_effect=[result])
    monkeypatch.setattr(direct, "_extract_page_text", extract)
    source = await direct.fetch_direct_source("https://8.8.8.8/report")
    if result == "Council housing evidence":
        assert source.url == "https://8.8.8.8/report"
        assert source.content == result
        assert source.source_type == "report"
    else:
        assert source is None


@pytest.mark.asyncio
async def test_redirect_is_validated_before_private_destination_contact(monkeypatch) -> None:
    from atlas.domains.discovery.pipeline import direct_sources as direct

    visited = []
    real_client = httpx.AsyncClient

    def transport(request: httpx.Request) -> httpx.Response:
        visited.append(str(request.url))
        assert "authorization" not in request.headers
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    def client(**kwargs: object) -> httpx.AsyncClient:
        return real_client(**kwargs, transport=httpx.MockTransport(transport))

    async def extract(client: httpx.AsyncClient, url: str) -> str:
        return (await client.get(url)).text

    monkeypatch.setattr(direct.httpx, "AsyncClient", client)
    monkeypatch.setattr(direct, "_extract_page_text", extract)
    with pytest.raises(ValueError, match="public"):
        await direct.fetch_direct_source("https://example.org")
    assert visited == ["https://example.org"]


@pytest.mark.asyncio
async def test_crawl_page_uses_scout_metadata_quality_links_and_credential_free_redirects(
    monkeypatch,
) -> None:
    from atlas.domains.discovery.pipeline import direct_sources as direct

    visited = []
    real_client = httpx.AsyncClient
    html = (
        """<html><head><title>Council action</title>
        <meta property="og:type" content="article"><meta property="og:site_name" content="Civic News">
        <meta property="article:published_time" content="2026-01-02T12:00:00Z"></head>
        <body><article><p>"""
        + "Council housing evidence matters to neighbors. " * 60
        + """</p></article>
        <a href="/members#top">Members</a><a href="https://elsewhere.org/">Other</a></body></html>"""
    )

    def transport(request) -> httpx.Response:
        visited.append(str(request.url))
        assert not any(
            header in request.headers for header in ["cookie", "authorization", "x-atlas-client-ip"]
        )
        if len(visited) == 1:
            return httpx.Response(
                302, headers={"location": "/article", "set-cookie": "private=secret"}
            )
        return httpx.Response(200, text=html)

    monkeypatch.setattr(
        direct.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(transport)),
    )
    result = await direct.fetch_direct_page("https://example.org")
    assert visited == ["https://example.org", "https://example.org/article"]
    assert result.page.url == "https://example.org"
    assert result.page.title == "Council action"
    assert result.page.publication == "Civic News"
    assert result.page.published_date.date().isoformat() == "2026-01-02"
    assert result.page.source_type == "news_article"
    assert result.discovered_links == ["https://example.org/members"]
    assert result.page.structured_data["opengraph"]["type"] == "article"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (httpx.ConnectError("offline"), "fetch_failed"),
        (TimeoutError(), "fetch_failed"),
        (ValueError("unsafe"), "public_source_rejected"),
    ],
)
async def test_crawl_page_records_unreadable_sources(monkeypatch, error, reason) -> None:
    from atlas.domains.discovery.pipeline import direct_sources as direct

    monkeypatch.setattr(direct, "fetch_public_source", AsyncMock(side_effect=error))
    result = await direct.fetch_direct_page("https://example.org")
    assert result.page is None
    assert result.reason == reason


@pytest.mark.asyncio
async def test_crawl_hosted_page_requires_its_request_owned_transport() -> None:
    from contextlib import asynccontextmanager

    from atlas.domains.discovery.pipeline import direct_sources as direct
    from atlas.platform.config import Settings
    from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime

    @asynccontextmanager
    async def fetch(url, headers) -> AsyncIterator[direct.PublicSourceResponse]:
        assert url == "https://example.org"
        assert headers["User-Agent"].startswith("AtlasBot")

        async def chunks() -> AsyncIterator[bytes]:
            yield b'<html><a href="/neighbors">Neighbors</a></html>'

        yield direct.PublicSourceResponse(200, {}, chunks())

    connect = AsyncMock()
    settings = Settings(_env_file=None)
    with (
        bind_hosted_runtime(HostedRuntime(settings=settings, connect=connect)),
        pytest.raises(RuntimeError, match="transport"),
    ):
        await direct.fetch_direct_page("https://example.org")
    with bind_hosted_runtime(
        HostedRuntime(settings=settings, connect=connect, public_source_fetch=fetch)
    ):
        result = await direct.fetch_direct_page("https://example.org")
    assert result.page is None
    assert result.discovered_links == ["https://example.org/neighbors"]
    connect.assert_not_awaited()
