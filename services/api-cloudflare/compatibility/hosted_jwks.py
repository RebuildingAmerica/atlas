"""Preload public verification keys asynchronously before synchronous auth checks."""

import asyncio
import base64
import binascii
import json
from time import monotonic

from public_source_transport import workers_public_source_fetch

_GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}


def _issuer(token):
    # Unverified claims select only an already configured public key endpoint.
    # They never grant identity or choose an arbitrary URL.
    try:
        if len(token) > 32768:
            return None
        payload = token.split(".")[1]
        claims = json.loads(
            base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        )
        issuer = claims.get("iss") if isinstance(claims, dict) else None
        return issuer if isinstance(issuer, str) else None
    except (ValueError, IndexError, binascii.Error):
        return None


class HostedJwksCache:
    """Cache public key documents for at most sixty seconds in one hosted app."""

    def __init__(self, settings, *, fetch=workers_public_source_fetch, clock=monotonic):
        self.settings = settings
        self.fetch = fetch
        self.clock = clock
        self.documents = {}
        self.attempts = {}
        self.lock = asyncio.Lock()

    async def for_headers(self, headers):
        urls = set()
        for name, value in headers:
            name = name.lower()
            if name not in (b"authorization", b"x-atlas-actor-assertion"):
                continue
            token = value.decode("latin1")
            if name == b"authorization":
                if not token.startswith("Bearer "):
                    continue
                token = token.removeprefix("Bearer ")
            issuer = _issuer(token)
            if (
                issuer == self.settings.auth_jwt_issuer
                and self.settings.auth_jwt_jwks_url
            ):
                urls.add(self.settings.auth_jwt_jwks_url)
            elif issuer in _GOOGLE_ISSUERS:
                from atlas.domains.access.machine import (
                    GoogleOidcIssuer,
                    parse_machine_issuers,
                )

                if any(
                    isinstance(item, GoogleOidcIssuer)
                    for item in parse_machine_issuers(
                        self.settings.machine_trusted_issuers
                    )
                ):
                    urls.add(_GOOGLE_CERTS)
        result = {}
        for url in urls:
            async with self.lock:
                now = self.clock()
                if url not in self.attempts or now - self.attempts[url] >= 60:
                    self.attempts[url] = now
                    self.documents.pop(url, None)
                    try:
                        async with asyncio.timeout(5):
                            async with self.fetch(
                                url, {"Accept": "application/json"}
                            ) as response:
                                if response.status_code != 200:
                                    raise ValueError("Verification keys unavailable")
                                body = bytearray()
                                async for chunk in response.body:
                                    body.extend(chunk)
                                    if len(body) > 65536:
                                        raise ValueError("Verification keys too large")
                                document = json.loads(body)
                                if not isinstance(document, dict) or not isinstance(
                                    document.get("keys"), list
                                ):
                                    raise ValueError("Invalid verification keys")
                                self.documents[url] = document
                    except asyncio.CancelledError:
                        self.attempts.pop(url, None)
                        raise
                    except Exception:
                        # Authentication refuses missing keys; never retain stale
                        # authority or try synchronous network as a fallback.
                        pass
                if url in self.documents:
                    result[url] = self.documents[url]
        return result
