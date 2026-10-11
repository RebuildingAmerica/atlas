"""Verify the operator's Cloudflare Access sign-in that the platform admin app forwards.

Access signs a person in through Google Workspace and adds a signed token to
every request it lets through to the admin app, in ``Cf-Access-Jwt-Assertion``.
The admin app forwards that header with each call to the API's platform
routes, so the API can check for itself who is acting rather than trust the
app's word for it.

A token is good only when it is signed with RS256 by one of the team's
published keys, names this team as issuer and this application's audience
tag, is current, and names a person by email. A service token, which names a
client rather than a person, never passes. The checks mirror the admin app's
own verifier in ``packages/atlas-access/src/perimeter/cloudflare-access.ts``.

https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from functools import cache
from typing import TYPE_CHECKING, Any, Literal, TypeGuard

import httpx
import jwt

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion"

_KEYS_FOR_SECONDS = 3600
"""The team's keys are kept for an hour; Access rotates them every six weeks."""

_REFETCH_AFTER_SECONDS = 60
"""A token naming an unknown key refetches at most once a minute."""

_CLOCK_SKEW_SECONDS = 60
"""Allowed difference between Cloudflare's clock and ours, for "not before"."""

_TEAM_DOMAIN = re.compile(r"^[a-z0-9-]+\.cloudflareaccess\.com$")
_AUDIENCE = re.compile(r"^[a-f0-9]{64}$")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

RefusalReason = Literal[
    "malformed",
    "wrong_algorithm",
    "wrong_audience",
    "wrong_issuer",
    "expired",
    "not_yet_valid",
    "service_token",
    "no_email",
    "key_fetch_failed",
    "unknown_key",
    "bad_signature",
]


@dataclass(frozen=True, slots=True)
class AccessConfig:
    """One Access team and one application."""

    team_domain: str
    audience: str

    @property
    def issuer(self) -> str:
        """Return the ``iss`` every token from this team carries."""
        return f"https://{self.team_domain}"

    @property
    def certs_url(self) -> str:
        """Return where the team publishes its signing keys."""
        return f"{self.issuer}/cdn-cgi/access/certs"


@dataclass(frozen=True, slots=True)
class AccessIdentity:
    """The person an Access token names."""

    email: str
    subject: str


@dataclass(frozen=True, slots=True)
class AccessResult:
    """A verified identity, or the reason the token was refused."""

    identity: AccessIdentity | None
    reason: RefusalReason | None = None


def _team_host(domain: str) -> str:
    host = re.sub(r"^https?://", "", domain.strip(), flags=re.IGNORECASE)
    return host.rstrip("/").lower()


def parse_access_config(team_domain: str, audience: str) -> AccessConfig | None:
    """Read the Access settings.

    Parameters
    ----------
    team_domain : str
        ``ATLAS_ACCESS_TEAM_DOMAIN``, with or without a scheme or trailing slash.
    audience : str
        ``ATLAS_ACCESS_AUD``, the application's audience tag.

    Returns
    -------
    AccessConfig | None
        The settings, or ``None`` when neither is set.

    Raises
    ------
    ValueError
        When only one is set or either is malformed, so a misconfigured
        deployment refuses rather than guessing.
    """
    raw_domain = team_domain.strip()
    raw_audience = audience.strip()
    if not raw_domain and not raw_audience:
        return None
    if not raw_domain:
        msg = "ATLAS_ACCESS_TEAM_DOMAIN is required when ATLAS_ACCESS_AUD is set."
        raise ValueError(msg)
    if not raw_audience:
        msg = "ATLAS_ACCESS_AUD is required when ATLAS_ACCESS_TEAM_DOMAIN is set."
        raise ValueError(msg)
    host = _team_host(raw_domain)
    if not _TEAM_DOMAIN.fullmatch(host):
        msg = "ATLAS_ACCESS_TEAM_DOMAIN must be a <team>.cloudflareaccess.com host."
        raise ValueError(msg)
    if not _AUDIENCE.fullmatch(raw_audience):
        msg = "ATLAS_ACCESS_AUD must be the 64-character application audience tag."
        raise ValueError(msg)
    return AccessConfig(team_domain=host, audience=raw_audience)


async def _fetch_certs(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(url)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        msg = "Access certs were not a JSON object."
        raise TypeError(msg)
    return body


def _audience_matches(aud: object, expected: str) -> bool:
    if isinstance(aud, list):
        return expected in aud
    return aud == expected


def _is_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _unverified_parts(token: str) -> tuple[str, dict[str, Any]] | RefusalReason:
    """Return the key id and claims, read without verifying, or why they are unusable."""
    try:
        header = jwt.get_unverified_header(token)
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return "malformed"
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str):
        return "wrong_algorithm"
    return kid, claims


def _time_refusal(claims: dict[str, Any], now: float) -> RefusalReason | None:
    exp = claims.get("exp")
    if not _is_number(exp) or float(exp) <= now:
        return "expired"
    if "nbf" in claims:
        nbf = claims["nbf"]
        if not _is_number(nbf) or float(nbf) > now + _CLOCK_SKEW_SECONDS:
            return "not_yet_valid"
    return None


def _person_refusal(claims: dict[str, Any]) -> RefusalReason | None:
    email = claims.get("email")
    if email is None and isinstance(claims.get("common_name"), str):
        return "service_token"
    if not isinstance(email, str) or not _EMAIL.fullmatch(email.strip()):
        return "no_email"
    return None


def _signature_valid(token: str, key: Any) -> bool:
    try:
        jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={
                "verify_aud": False,
                "verify_iss": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
            },
        )
    except jwt.PyJWTError:
        return False
    return True


class CloudflareAccessVerifier:
    """Verify Access tokens for one team and application, caching the team's keys."""

    def __init__(
        self,
        config: AccessConfig,
        *,
        fetch_certs: Callable[[str], Awaitable[dict[str, Any]]] = _fetch_certs,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._config = config
        self._fetch_certs = fetch_certs
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None

    async def verify(self, token: str) -> AccessResult:
        """Return the person the token names, or why it was refused.

        Parameters
        ----------
        token : str
            The ``Cf-Access-Jwt-Assertion`` value.

        Returns
        -------
        AccessResult
            The identity, or a refusal reason for the server log. The reason is
            never shown to the caller, and the token is never logged.
        """
        parts = _unverified_parts(token)
        if isinstance(parts, str):
            return AccessResult(None, parts)
        kid, claims = parts
        refusal = self._check_claims(claims)
        if refusal is None:
            refusal = await self._signature_refusal(token, kid)
        if refusal is not None:
            return AccessResult(None, refusal)
        subject = claims.get("sub")
        return AccessResult(
            AccessIdentity(
                email=str(claims["email"]).strip().lower(),
                subject=subject if isinstance(subject, str) else "",
            )
        )

    def _check_claims(self, claims: dict[str, Any]) -> RefusalReason | None:
        """Run the checks that need no key, before anything is fetched."""
        if not _audience_matches(claims.get("aud"), self._config.audience):
            return "wrong_audience"
        if claims.get("iss") != self._config.issuer:
            return "wrong_issuer"
        return _time_refusal(claims, self._clock()) or _person_refusal(claims)

    async def _signature_refusal(self, token: str, kid: str) -> RefusalReason | None:
        """Check the signature against the team's key named by ``kid``."""
        try:
            key = await self._key_for(kid)
        except Exception:
            return "key_fetch_failed"
        if key is None:
            return "unknown_key"
        return None if _signature_valid(token, key) else "bad_signature"

    async def _key_for(self, kid: str) -> Any:
        now = self._clock()
        fetched_at = self._fetched_at
        stale = fetched_at is None or now - fetched_at > _KEYS_FOR_SECONDS
        unknown = (
            fetched_at is not None
            and kid not in self._keys
            and now - fetched_at > _REFETCH_AFTER_SECONDS
        )
        if stale or unknown:
            await self._refresh(now)
        return self._keys.get(kid)

    async def _refresh(self, now: float) -> None:
        body = await self._fetch_certs(self._config.certs_url)
        keys: dict[str, Any] = {}
        for jwk in body.get("keys", []):
            if not isinstance(jwk, dict) or jwk.get("kty") != "RSA":
                continue
            kid = jwk.get("kid")
            if isinstance(kid, str) and kid:
                keys[kid] = jwt.PyJWK(jwk, algorithm="RS256").key
        self._keys = keys
        self._fetched_at = now


@cache
def access_verifier_for(config: AccessConfig) -> CloudflareAccessVerifier:
    """Return the process-wide verifier for one team and application.

    Parameters
    ----------
    config : AccessConfig
        The team and application.

    Returns
    -------
    CloudflareAccessVerifier
        A verifier whose key cache is shared by every request.
    """
    return CloudflareAccessVerifier(config)
