"""Direct-source transport keeps explicit seeds and rejects local redirects."""

from __future__ import annotations

from unittest.mock import AsyncMock

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
