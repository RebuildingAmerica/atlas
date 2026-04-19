"""HTTP cache helpers for Atlas API endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import Response

__all__ = [
    "apply_no_store_headers",
    "apply_short_public_cache",
    "apply_static_public_cache",
]


def apply_static_public_cache(response: Response | None) -> None:
    """Cache stable public resources aggressively with revalidation."""
    if response is None:
        return
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    response.headers["Vary"] = "Accept, Accept-Encoding"


def apply_short_public_cache(response: Response | None) -> None:
    """Cache public search/aggregation resources briefly."""
    if response is None:
        return
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    response.headers["Vary"] = "Accept, Accept-Encoding"


def apply_no_store_headers(response: Response | None) -> None:
    """Disable caching for mutable or operator-oriented resources."""
    if response is None:
        return
    response.headers["Cache-Control"] = "no-store"
