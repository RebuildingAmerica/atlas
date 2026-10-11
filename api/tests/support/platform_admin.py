"""Stand-ins for the platform admin app and Cloudflare Access in API tests.

The admin app signs its calls with an Ed25519 key and forwards the operator's
Access assertion. Tests use a generated Ed25519 key in place of the admin
app's and a generated RSA key in place of the Access team's.
"""

from __future__ import annotations

import base64
import json
import time
from typing import TYPE_CHECKING, Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from atlas.domains.access.cloudflare_access import AccessConfig, CloudflareAccessVerifier
from atlas.main import create_app
from atlas.platform.authz import platform_guard
from atlas.platform.authz.dependency import trusted_issuers
from atlas.platform.config import Settings, get_settings

if TYPE_CHECKING:
    import pytest
    from fastapi import FastAPI

OPERATOR_EMAIL = "willie@rebuildingus.org"
ADMIN_ISSUER = "https://atlas-admin.example.test"
ADMIN_AUDIENCE = "urn:atlas:platform-api"
ACCESS_TEAM_DOMAIN = "atlas-test.cloudflareaccess.com"
ACCESS_AUD = "ab" * 32
ACCESS_KID = "access-test-key"
PLATFORM_ACTIONS = [
    "platform.discounts.review",
    "platform.costs.view",
    "platform.switches.read",
    "platform.switches.write",
    "platform.accounts.read",
]

ADMIN_KEY = Ed25519PrivateKey.generate()
ADMIN_PUBLIC_KEY = base64.b64encode(
    ADMIN_KEY.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
).decode()
ACCESS_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def admin_issuers(actions: list[str] | None = None) -> str:
    """Return ``ATLAS_MACHINE_TRUSTED_ISSUERS`` trusting the test admin app."""
    return json.dumps(
        [
            {
                "kind": "ed25519_jwt",
                "name": "atlas-admin",
                "issuer": ADMIN_ISSUER,
                "audience": ADMIN_AUDIENCE,
                "public_key": ADMIN_PUBLIC_KEY,
                "actions": PLATFORM_ACTIONS if actions is None else actions,
            }
        ]
    )


def sign_admin_token(acting_for: str | None = OPERATOR_EMAIL, **overrides: object) -> str:
    """Return a token as the admin app would sign it, acting for ``acting_for``."""
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": ADMIN_ISSUER,
        "aud": ADMIN_AUDIENCE,
        "sub": "atlas-admin",
        "iat": now,
        "exp": now + 60,
    }
    if acting_for is not None:
        claims["act"] = acting_for
    claims.update(overrides)
    return jwt.encode(claims, ADMIN_KEY, algorithm="EdDSA")


def sign_access_token(
    email: str | None = OPERATOR_EMAIL,
    *,
    key: rsa.RSAPrivateKey = ACCESS_KEY,
    kid: str = ACCESS_KID,
    algorithm: str = "RS256",
    **overrides: object,
) -> str:
    """Return a ``Cf-Access-Jwt-Assertion`` as the test Access team would sign it."""
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": f"https://{ACCESS_TEAM_DOMAIN}",
        "aud": [ACCESS_AUD],
        "sub": "access-user-id",
        "iat": now,
        "nbf": now,
        "exp": now + 300,
    }
    if email is not None:
        claims["email"] = email
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": kid})


def access_certs(*keys: tuple[str, rsa.RSAPrivateKey]) -> dict[str, Any]:
    """Return the team's published keys, as ``/cdn-cgi/access/certs`` would."""
    published = keys or ((ACCESS_KID, ACCESS_KEY),)
    entries = []
    for kid, private_key in published:
        jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
        entries.append({**jwk, "kid": kid})
    return {"keys": entries}


def access_config() -> AccessConfig:
    """Return the test Access team and application."""
    return AccessConfig(team_domain=ACCESS_TEAM_DOMAIN, audience=ACCESS_AUD)


def trust_test_access_team(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the platform guard verify Access tokens against the test team's key."""

    async def _certs(_url: str) -> dict[str, Any]:
        return access_certs()

    verifiers: dict[AccessConfig, CloudflareAccessVerifier] = {}

    def _verifier_for(config: AccessConfig) -> CloudflareAccessVerifier:
        return verifiers.setdefault(config, CloudflareAccessVerifier(config, fetch_certs=_certs))

    monkeypatch.setattr(platform_guard, "access_verifier_for", _verifier_for)
    trusted_issuers.cache_clear()


def platform_settings(database_url: str = "sqlite:///unused.db", **overrides: Any) -> Settings:
    """Return managed settings that trust the test admin app and Access team."""
    values: dict[str, Any] = {
        "managed": True,
        "multi_user": True,
        "database_url": database_url,
        "auth_callback_secret": "callback-test-secret",  # pragma: allowlist secret
        "auth_jwt_audience": ["https://atlas.example.test/mcp"],
        "auth_jwt_issuer": "https://atlas.example.test",
        "auth_api_key_introspection_url": "https://atlas.example.test/api/auth/internal/api-key",
        "auth_membership_verification_url": "https://atlas.example.test",
        "machine_trusted_issuers": admin_issuers(),
        "access_team_domain": ACCESS_TEAM_DOMAIN,
        "access_aud": ACCESS_AUD,
        "platform_operator_emails": [OPERATOR_EMAIL],
    }
    values.update(overrides)
    return Settings(**values)


def managed_app(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> FastAPI:
    """Return an app built as a managed deployment, so its platform routes are mounted.

    Requests see ``settings`` and verify Access tokens against the test team.
    """
    monkeypatch.setenv("ATLAS_MANAGED", "true")
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    trust_test_access_team(monkeypatch)
    return app


def platform_headers(email: str = OPERATOR_EMAIL) -> dict[str, str]:
    """Return the headers the admin app sends when acting for ``email``."""
    return {
        "Authorization": f"Bearer {sign_admin_token(email)}",
        "Cf-Access-Jwt-Assertion": sign_access_token(email),
    }
