"""Tests for the focused pipeline support helpers."""

from __future__ import annotations

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline_support import (
    ExtractionAdmission,
    close_if_supported,
    decide_extraction_admission,
    error_reason,
    extract_worker_count,
    merge_discovered_links,
    normalize_url,
    parse_location,
    same_domain,
    strip_code_fence,
)

# ---------------------------------------------------------------------------
# decide_extraction_admission / ExtractionAdmission
# ---------------------------------------------------------------------------


def test_decide_extraction_admission_uses_depth_for_priority() -> None:
    page = PageContent(url="https://example.com", text="content " * 80)
    admission = decide_extraction_admission(page=page, depth=2)

    assert admission.priority == 20
    assert admission.should_extract is True
    assert admission.skip_reason is None


def test_extraction_admission_should_extract_false_when_priority_none() -> None:
    admission = ExtractionAdmission(priority=None, skip_reason="filtered")
    assert admission.should_extract is False


# ---------------------------------------------------------------------------
# extract_worker_count
# ---------------------------------------------------------------------------


def test_extract_worker_count_uses_provider_concurrency() -> None:
    class Provider:
        max_concurrent = 4

    assert extract_worker_count(Provider(), direct_mode=False) == 4


def test_extract_worker_count_clamps_to_at_least_one() -> None:
    class Provider:
        max_concurrent = 0

    assert extract_worker_count(Provider(), direct_mode=True) == 1


# ---------------------------------------------------------------------------
# merge_discovered_links
# ---------------------------------------------------------------------------


def test_merge_discovered_links_merges_raw_and_page_links() -> None:
    page = PageContent(
        url="https://example.com",
        text="x" * 80,
        discovered_links=["https://example.com/page-b", "https://example.com/page-a"],
    )
    result = merge_discovered_links(["https://example.com/page-a"], page)
    assert result == ["https://example.com/page-a", "https://example.com/page-b"]


def test_merge_discovered_links_ignores_non_list_raw_input() -> None:
    page = PageContent(
        url="https://example.com",
        text="x" * 80,
        discovered_links=["https://example.com/page-a"],
    )
    result = merge_discovered_links("not-a-list", page)
    assert result == ["https://example.com/page-a"]


def test_merge_discovered_links_ignores_invalid_values_in_list() -> None:
    page = PageContent(url="https://example.com", text="x" * 80, discovered_links=[])
    result = merge_discovered_links(["", "  "], page)
    assert result == []


def test_merge_discovered_links_when_page_is_not_pagecontent() -> None:
    result = merge_discovered_links(["https://example.com/a"], None)
    assert result == ["https://example.com/a"]


# ---------------------------------------------------------------------------
# normalize_url
# ---------------------------------------------------------------------------


def test_normalize_url_preserves_path_trailing_slash() -> None:
    assert normalize_url("https://example.com/path/") == "https://example.com/path/"


def test_normalize_url_strips_root_trailing_slash() -> None:
    assert normalize_url("https://example.com/") == "https://example.com"


def test_normalize_url_returns_empty_for_blank_input() -> None:
    assert normalize_url("   ") == ""


def test_normalize_url_strips_fragment() -> None:
    assert normalize_url("https://example.com/path#fragment") == "https://example.com/path"


# ---------------------------------------------------------------------------
# same_domain
# ---------------------------------------------------------------------------


def test_same_domain_matches_same_host() -> None:
    assert same_domain("https://example.com/a", "https://example.com/b") is True


def test_same_domain_rejects_different_host() -> None:
    assert same_domain("https://example.com/a", "https://other.example/b") is False


def test_same_domain_rejects_non_http_scheme() -> None:
    assert same_domain("https://example.com", "mailto:foo@example.com") is False


# ---------------------------------------------------------------------------
# parse_location
# ---------------------------------------------------------------------------


def test_parse_location_handles_city_only() -> None:
    assert parse_location("Houston") == ("Houston", "")


# ---------------------------------------------------------------------------
# error_reason
# ---------------------------------------------------------------------------


def test_error_reason_uses_class_name_when_message_blank() -> None:
    assert error_reason(RuntimeError("")) == "RuntimeError"


def test_error_reason_uses_stripped_message() -> None:
    assert error_reason(RuntimeError("  oops  ")) == "oops"


# ---------------------------------------------------------------------------
# strip_code_fence
# ---------------------------------------------------------------------------


def test_strip_code_fence_removes_wrapping_backticks() -> None:
    fenced = '```json\n{"k": 1}\n```'
    assert strip_code_fence(fenced) == '{"k": 1}'


def test_strip_code_fence_returns_input_when_unfenced() -> None:
    assert strip_code_fence("plain text") == "plain text"


# ---------------------------------------------------------------------------
# close_if_supported
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_close_if_supported_calls_async_aclose() -> None:
    closed: list[str] = []

    class WithAclose:
        async def aclose(self) -> None:
            closed.append("aclose")

    await close_if_supported(WithAclose())
    assert closed == ["aclose"]


@pytest.mark.asyncio
async def test_close_if_supported_calls_sync_close() -> None:
    closed: list[str] = []

    class WithSyncClose:
        def close(self) -> None:
            closed.append("close")

    await close_if_supported(WithSyncClose())
    assert closed == ["close"]


@pytest.mark.asyncio
async def test_close_if_supported_no_op_when_no_close() -> None:
    class NoClose:
        pass

    await close_if_supported(NoClose())
