"""Tests for atlas_scout.steps.verify."""

from __future__ import annotations

import httpx
import pytest
import respx
from atlas_shared import RawEntry

from atlas_scout.steps.verify import verify_entries

_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


def _entry(
    *,
    name: str = "Test Org",
    entry_type: str = "organization",
    website: str | None = None,
    city: str | None = None,
) -> RawEntry:
    return RawEntry(
        name=name,
        entry_type=entry_type,
        description="Some description.",
        city=city,
        state=None,
        geo_specificity="local",
        issue_areas=[],
        affiliated_org=None,
        website=website,
        email=None,
        social_media={},
        extraction_context="Some context",
        mentioned_entities=[],
    )


@pytest.mark.asyncio
async def test_verify_entries_returns_empty_when_no_entries() -> None:
    """An empty input list short-circuits and returns empty."""
    assert await verify_entries([]) == []


@pytest.mark.asyncio
@respx.mock
async def test_verify_entries_passes_when_website_resolves() -> None:
    """A 200 HEAD on the website is considered verified."""
    respx.head("https://testorg.org").mock(return_value=httpx.Response(200))

    entry = _entry(website="https://testorg.org")
    result = await verify_entries([entry], reverse_search=False)

    assert len(result) == 1
    assert result[0].name == "Test Org"


@pytest.mark.asyncio
@respx.mock
async def test_verify_entries_logs_failure_when_website_does_not_resolve(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When HEAD returns >= 400 the failure path is logged."""
    respx.head("https://broken.example").mock(return_value=httpx.Response(500))

    entry = _entry(website="https://broken.example")
    with caplog.at_level("DEBUG", logger="atlas_scout.steps.verify"):
        result = await verify_entries([entry], reverse_search=False)

    assert len(result) == 1


@pytest.mark.asyncio
@respx.mock
async def test_verify_entries_handles_request_error_on_head() -> None:
    """A network error during HEAD is caught and treated as not-resolved."""
    respx.head("https://broken.example").mock(side_effect=httpx.ConnectError("boom"))

    entry = _entry(website="https://broken.example")
    result = await verify_entries([entry], reverse_search=False)

    assert len(result) == 1


@pytest.mark.asyncio
@respx.mock
async def test_verify_entries_reverse_search_zero_hits_marks_failed(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A reverse search returning 0 hits is logged as failure."""
    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=httpx.Response(200, json={"web": {"results": []}})
    )

    entry = _entry(name="Phantom Org", entry_type="organization", city="Austin")
    with caplog.at_level("INFO", logger="atlas_scout.steps.verify"):
        result = await verify_entries(
            [entry],
            search_api_key="key",
            check_websites=False,
        )

    assert len(result) == 1
    assert any("Verification failed" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
@respx.mock
async def test_verify_entries_reverse_search_with_results_passes() -> None:
    """A reverse search with hits is treated as verified."""
    respx.get(_BRAVE_SEARCH_URL).mock(
        return_value=httpx.Response(
            200,
            json={"web": {"results": [{"url": "https://example.com"}]}},
        )
    )

    entry = _entry(name="Real Org", entry_type="organization")
    result = await verify_entries([entry], search_api_key="key", check_websites=False)

    assert len(result) == 1


@pytest.mark.asyncio
@respx.mock
async def test_verify_entries_reverse_search_handles_request_error() -> None:
    """A search RequestError yields hit_count=-1 which counts as verified."""
    respx.get(_BRAVE_SEARCH_URL).mock(side_effect=httpx.ConnectError("boom"))

    entry = _entry(name="Network Org", entry_type="organization")
    result = await verify_entries([entry], search_api_key="key", check_websites=False)

    assert len(result) == 1


@pytest.mark.asyncio
async def test_verify_entries_skips_reverse_search_for_people() -> None:
    """People entry types do not trigger reverse search even with key set."""
    entry = _entry(name="Some Person", entry_type="person")

    result = await verify_entries(
        [entry],
        search_api_key="key",
        check_websites=False,
    )

    assert len(result) == 1


@pytest.mark.asyncio
async def test_verify_entries_skips_reverse_search_when_no_api_key() -> None:
    """No API key disables reverse search."""
    entry = _entry(name="Some Org", entry_type="organization")

    result = await verify_entries(
        [entry],
        search_api_key="",
        check_websites=False,
    )

    assert len(result) == 1


@pytest.mark.asyncio
async def test_verify_entries_with_no_website_and_no_search() -> None:
    """An entry with no website and no reverse search still passes through."""
    entry = _entry(name="Bare Org", website=None)

    result = await verify_entries([entry], check_websites=True, reverse_search=False)

    assert len(result) == 1
