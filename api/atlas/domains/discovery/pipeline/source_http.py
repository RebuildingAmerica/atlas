"""Invocation-owned public egress contract for reading source evidence safely."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv6Address, IPv6Network, ip_address
from typing import TYPE_CHECKING, Protocol
from urllib.parse import urljoin, urlsplit

import httpx

from .source_fetcher import PAGE_FETCH_HEADERS

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping
    from contextlib import AbstractAsyncContextManager


@dataclass(frozen=True)
class PublicSourceResponse:
    """One response whose context closes its decoded byte stream on every exit."""

    status_code: int
    headers: Mapping[str, str]
    body: AsyncIterator[bytes]


class PublicSourceFetcher(Protocol):  # pragma: no cover - typing-only protocol
    """Fetch one URL through enforced public egress, without following redirects.

    Implementations must not use a service/VPC binding or application identity.
    The body must stream decoded bytes; closing the context must cancel/release
    the underlying response. Provider egress enforcement requires hosted proof.
    """

    def __call__(
        self, url: str, headers: Mapping[str, str]
    ) -> AbstractAsyncContextManager[PublicSourceResponse]: ...


_ASCII_SPACE = 32
_ASCII_DELETE = 127
_NAT64 = IPv6Network("64:ff9b::/96")


def _unambiguous_url(url: str) -> None:
    if "\\" in url or any(
        ord(character) <= _ASCII_SPACE or ord(character) == _ASCII_DELETE for character in url
    ):
        raise ValueError("Public source URL contains ambiguous characters")  # noqa: TRY003


def validate_public_source_url(url: str) -> None:
    """Reject unsafe URL syntax; transport must separately enforce public DNS egress."""
    _unambiguous_url(url)
    parsed = urlsplit(url)
    host = (parsed.hostname or "").encode("idna").decode("ascii").rstrip(".").lower()
    if (
        parsed.scheme not in {"https", "http"}
        or parsed.username is not None
        or parsed.password is not None
        or not host
    ):
        raise ValueError("Direct discovery requires a public HTTP(S) URL")  # noqa: TRY003
    if parsed.port == 0 or "%" in host:
        raise ValueError("Public source URL has an invalid destination")  # noqa: TRY003
    try:
        address = ip_address(host)
    except ValueError:
        if (
            "." not in host
            or host.endswith((".localhost", ".local", ".internal"))
            or re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*", host)
        ):
            raise ValueError("Direct discovery requires a public host") from None  # noqa: TRY003
    else:
        embedded = None
        if isinstance(address, IPv6Address):
            embedded = address.ipv4_mapped or address.sixtofour
            if address in _NAT64:
                embedded = IPv4Address(int(address) & 0xFFFFFFFF)
        if (
            not address.is_global
            or address.is_multicast
            or address.is_reserved
            or (embedded is not None and not embedded.is_global)
        ):
            raise ValueError("Direct discovery requires a public address")  # noqa: TRY003


async def fetch_public_source(
    url: str,
    fetcher: PublicSourceFetcher,
    *,
    max_bytes: int = 8 * 1024 * 1024,
    max_redirects: int = 20,
    timeout: float = 20,
) -> httpx.Response:
    """Read bounded source bytes through the current invocation's public transport.

    Parameters
    ----------
    url, fetcher
        Public source URL and provider-enforced public egress. No cookies,
        caller headers, API keys, or application credentials cross this boundary.
    max_bytes, max_redirects, timeout
        Decoded body cap, redirect cap and total wall-clock deadline.

    Returns
    -------
    httpx.Response
        A fully read response for existing text extraction. Every redirect is
        validated before the next request; every response closes on every exit.
        URL syntax checks alone do not establish DNS rebinding protection.
    """
    redirects = 0
    async with asyncio.timeout(timeout):
        while True:
            validate_public_source_url(url)
            async with fetcher(url, dict(PAGE_FETCH_HEADERS)) as response:
                headers = {name.lower(): value for name, value in response.headers.items()}
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = headers.get("location")
                    if not location or redirects >= max_redirects:
                        raise ValueError("Public source redirect limit or location is invalid")  # noqa: TRY003
                    _unambiguous_url(location)
                    url = urljoin(url, location)
                    redirects += 1
                    continue
                request = httpx.Request("GET", url)
                httpx.Response(response.status_code, request=request).raise_for_status()
                if "content-length" in headers:
                    length = int(headers["content-length"])
                    if length < 0 or length > max_bytes:
                        raise ValueError("Public source body exceeds its size limit")  # noqa: TRY003
                content = bytearray()
                async for chunk in response.body:
                    if len(content) + len(chunk) > max_bytes:
                        raise ValueError("Public source body exceeds its size limit")  # noqa: TRY003
                    content.extend(chunk)
                # The provider yields decoded bytes. Do not decompress twice or
                # retain an encoded Content-Length that contradicts these bytes.
                headers.pop("content-encoding", None)
                headers.pop("content-length", None)
                return httpx.Response(
                    response.status_code, headers=headers, content=bytes(content), request=request
                )
