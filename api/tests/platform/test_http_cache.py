"""Tests for HTTP caching header helpers."""

from __future__ import annotations

from fastapi import Response

from atlas.platform.http.cache import (
    apply_no_store_headers,
    apply_short_public_cache,
    apply_static_public_cache,
)


def test_apply_static_public_cache_sets_long_lived_headers() -> None:
    response = Response()
    apply_static_public_cache(response)
    assert "max-age=3600" in response.headers["Cache-Control"]
    assert response.headers["Vary"] == "Accept, Accept-Encoding"


def test_apply_short_public_cache_sets_brief_max_age() -> None:
    response = Response()
    apply_short_public_cache(response)
    assert "max-age=60" in response.headers["Cache-Control"]


def test_apply_no_store_headers_disables_caching() -> None:
    response = Response()
    apply_no_store_headers(response)
    assert response.headers["Cache-Control"] == "no-store"


def test_helpers_no_op_on_none_response() -> None:
    apply_static_public_cache(None)
    apply_short_public_cache(None)
    apply_no_store_headers(None)
