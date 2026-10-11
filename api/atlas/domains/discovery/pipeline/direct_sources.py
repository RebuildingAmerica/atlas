"""Fetch a supplied public source without synthesizing a search query."""

from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlsplit

import httpx

from .source_fetcher import (
    PAGE_FETCH_HEADERS,
    FetchedSource,
    _extract_page_text,
    _infer_source_type,
)


def _public_url(url: str) -> None:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").rstrip(".").lower()
    if parsed.scheme not in {"https", "http"} or parsed.username or parsed.password or not host:
        raise ValueError("Direct discovery requires a public HTTP(S) URL")  # noqa: TRY003
    try:
        address = ip_address(host)
    except ValueError:
        if "." not in host or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError("Direct discovery requires a public host") from None  # noqa: TRY003
    else:
        if not address.is_global:
            raise ValueError("Direct discovery requires a public address")  # noqa: TRY003


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
    _public_url(url)

    async def validate_redirect(request: httpx.Request) -> None:
        _public_url(str(request.url))

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
