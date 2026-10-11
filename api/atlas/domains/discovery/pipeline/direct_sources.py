"""Fetch a supplied public source without synthesizing a search query."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import httpx
from atlas_discovery_engine.web_content import ContentExtraction, extract_html_content

from atlas.platform.hosted_runtime import current_hosted_runtime

from .source_fetcher import (
    PAGE_FETCH_HEADERS,
    FetchedSource,
    _extract_page_text,
    _infer_source_type,
)
from .source_http import PublicSourceResponse, fetch_public_source, validate_public_source_url

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping


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


async def fetch_direct_page(url: str) -> ContentExtraction:
    """Read bounded HTML with Scout's link, metadata and source-quality rules.

    Parameters
    ----------
    url
        Public source URL. Each redirect is validated by the common transport.

    Returns
    -------
    ContentExtraction
        A source page or explicit failure/filter reason, including links from
        sparse pages. PDF, structured files and browser rendering require their
        existing specialized parsers and are not implemented by this adapter.
    """
    runtime = current_hosted_runtime()
    if runtime is not None:
        if runtime.public_source_fetch is None:
            raise RuntimeError("Hosted public-source transport is not configured")  # noqa: TRY003
        fetcher = runtime.public_source_fetch
    else:
        fetcher = _ordinary_source_fetch
    try:
        response = await fetch_public_source(url, fetcher=fetcher)
        response.raise_for_status()
    except (httpx.HTTPError, TimeoutError):
        return ContentExtraction(None, "fetch_failed", [])
    except ValueError:
        return ContentExtraction(None, "public_source_rejected", [])

    import trafilatura

    return extract_html_content(
        response.text,
        url,
        text_reader=lambda body: trafilatura.extract(
            body, include_comments=False, include_tables=True
        ),
        metadata_reader=trafilatura.extract_metadata,
    )


@asynccontextmanager
async def _ordinary_source_fetch(
    url: str, headers: Mapping[str, str]
) -> AsyncIterator[PublicSourceResponse]:
    # A fresh client per hop cannot retain a publisher's cookies on redirects.
    async with (
        httpx.AsyncClient(follow_redirects=False, timeout=20.0) as client,
        client.stream("GET", url, headers=headers) as response,
    ):
        yield PublicSourceResponse(response.status_code, response.headers, response.aiter_bytes())
