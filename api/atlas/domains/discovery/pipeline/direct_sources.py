"""Fetch a supplied public source without synthesizing a search query."""

from __future__ import annotations

import httpx

from atlas.platform.hosted_runtime import current_hosted_runtime

from .source_fetcher import (
    PAGE_FETCH_HEADERS,
    FetchedSource,
    _extract_page_text,
    _infer_source_type,
)
from .source_http import validate_public_source_url


async def fetch_direct_source(url: str) -> FetchedSource | None:
    """Fetch source text; validate each redirect before contacting its destination.

    Parameters
    ----------
    url
        Explicit public seed URL. No application cookies or vendor credentials
        are forwarded. Private literals/local names are rejected at every hop.

    Returns
    -------
    FetchedSource | None
        Extractable text, or None for an empty page or an HTTP failure. The
        supplied URL remains the evidence identity after a public redirect.
    """
    validate_public_source_url(url)
    runtime = current_hosted_runtime()
    if runtime is not None and runtime.public_source_fetch is None:
        raise RuntimeError("Hosted public-source transport is not configured")  # noqa: TRY003

    async def validate_redirect(request: httpx.Request) -> None:
        validate_public_source_url(str(request.url))

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=20.0,
        headers=PAGE_FETCH_HEADERS,
        event_hooks={"request": [validate_redirect]},
    ) as client:
        try:
            content = await _extract_page_text(client, url)
        except httpx.HTTPError:
            return None
    if not content.strip():
        return None
    return FetchedSource(url, None, None, None, content, _infer_source_type(url, None))
