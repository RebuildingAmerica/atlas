"""Credentials machines present to the API, each trusted only for named actions.

A machine is never a person and never holds a person's authority. Each trusted
issuer is declared explicitly in ``ATLAS_MACHINE_TRUSTED_ISSUERS``, a JSON list,
and there is no default: a deployment that declares none trusts no machine.

Three kinds of issuer exist:

``google_oidc``
    Google-signed ID tokens for one service account and one audience, which is
    what Cloud Scheduler sends when a job is configured with an OIDC token.
``ed25519_jwt``
    Short-lived tokens signed by an internal app, such as the platform admin,
    with a key whose public half is in the config. The token may name the
    person it acts for in an ``act`` claim, which goes to the audit log.
``static_key``
    A long random key, stored only as its SHA-256 digest, for a self-hosted
    deployment whose scheduler cannot mint tokens.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
from dataclasses import dataclass
from functools import cache
from secrets import compare_digest
from typing import Annotated, Literal

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from jwt import PyJWKClient
from pydantic import BaseModel, Field, TypeAdapter, ValidationError, field_validator

logger = logging.getLogger(__name__)

GOOGLE_ISSUER = "https://accounts.google.com"
_GOOGLE_ISSUERS = frozenset({GOOGLE_ISSUER, "accounts.google.com"})
_GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_MAX_APP_TOKEN_LIFETIME_SECONDS = 120
_LEEWAY_SECONDS = 30
_SETTING = "ATLAS_MACHINE_TRUSTED_ISSUERS"


def _validate_actions(actions: list[str]) -> list[str]:
    """Allow only machine and platform actions; instance authority belongs to people."""
    # Imported here: the authorization package imports this module.
    from atlas.platform.authz.actions import Action

    for name in actions:
        try:
            action = Action(name)
        except ValueError as exc:
            msg = f"{name} is not a known action"
            raise ValueError(msg) from exc
        if not (action.is_machine or action.is_platform):
            msg = f"{name} is not a machine or platform action"
            raise ValueError(msg)
    return actions


class _IssuerBase(BaseModel):
    name: str = Field(min_length=1)
    actions: list[str]

    @field_validator("actions")
    @classmethod
    def _known_machine_actions(cls, actions: list[str]) -> list[str]:
        return _validate_actions(actions)


class GoogleOidcIssuer(_IssuerBase):
    """Google ID tokens for one service account and audience."""

    kind: Literal["google_oidc"]
    service_account: str = Field(min_length=1)
    audience: str = Field(min_length=1)


class Ed25519JwtIssuer(_IssuerBase):
    """Tokens an internal app signs with an Ed25519 key."""

    kind: Literal["ed25519_jwt"]
    issuer: str = Field(min_length=1)
    audience: str = Field(min_length=1)
    public_key: str

    @field_validator("public_key")
    @classmethod
    def _ed25519_public_key(cls, value: str) -> str:
        try:
            raw = base64.b64decode(value, validate=True)
            Ed25519PublicKey.from_public_bytes(raw)
        except (binascii.Error, ValueError) as exc:
            msg = "public_key must be a base64 Ed25519 public key"
            raise ValueError(msg) from exc
        return value


class StaticKeyIssuer(_IssuerBase):
    """A static key, stored only as its SHA-256 digest."""

    kind: Literal["static_key"]
    key_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


MachineIssuer = Annotated[
    GoogleOidcIssuer | Ed25519JwtIssuer | StaticKeyIssuer,
    Field(discriminator="kind"),
]
_ISSUERS_ADAPTER: TypeAdapter[list[MachineIssuer]] = TypeAdapter(list[MachineIssuer])


@dataclass(frozen=True, slots=True)
class MachinePrincipal:
    """A machine the API verified, and what it may do."""

    issuer_name: str
    kind: str
    subject: str
    actions: frozenset[str]
    acting_for: str | None


def parse_machine_issuers(raw: str) -> list[MachineIssuer]:
    """Parse and check ``ATLAS_MACHINE_TRUSTED_ISSUERS``.

    Parameters
    ----------
    raw : str
        The setting's value; empty means no machine is trusted.

    Returns
    -------
    list[MachineIssuer]
        The declared issuers.

    Raises
    ------
    ValueError
        When the value is not a JSON list of valid, uniquely named issuers.
    """
    if not raw.strip():
        return []
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        msg = f"{_SETTING} must be a JSON list of issuers."
        raise ValueError(msg) from exc
    if not isinstance(decoded, list):
        msg = f"{_SETTING} must be a JSON list of issuers."
        raise ValueError(msg)  # noqa: TRY004 - a bad setting is a value error for every caller
    try:
        issuers = _ISSUERS_ADAPTER.validate_python(decoded)
    except ValidationError as exc:
        msg = f"{_SETTING} is invalid: {exc}"
        raise ValueError(msg) from exc
    names = [issuer.name for issuer in issuers]
    if len(names) != len(set(names)):
        msg = f"{_SETTING} issuer names must be unique."
        raise ValueError(msg)
    return issuers


@cache
def _google_jwks_client() -> PyJWKClient:
    return PyJWKClient(_GOOGLE_CERTS_URL, cache_jwk_set=True, lifespan=3600)


def _principal(
    issuer: _IssuerBase, kind: str, subject: str, acting_for: str | None
) -> MachinePrincipal:
    return MachinePrincipal(
        issuer_name=issuer.name,
        kind=kind,
        subject=subject,
        actions=frozenset(issuer.actions),
        acting_for=acting_for,
    )


def _verify_static(token: str, issuers: list[StaticKeyIssuer]) -> MachinePrincipal | None:
    digest = hashlib.sha256(token.encode()).hexdigest()
    for issuer in issuers:
        if compare_digest(digest, issuer.key_sha256):
            return _principal(issuer, issuer.kind, issuer.name, None)
    return None


def _verify_google(token: str, issuers: list[GoogleOidcIssuer]) -> MachinePrincipal | None:
    try:
        key = _google_jwks_client().get_signing_key_from_jwt(token).key
        audiences = [issuer.audience for issuer in issuers]
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audiences,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "iss", "aud", "email"]},
        )
    except jwt.PyJWTError:
        return None
    if claims.get("iss") not in _GOOGLE_ISSUERS or claims.get("email_verified") is not True:
        return None
    for issuer in issuers:
        if claims.get("aud") == issuer.audience and claims.get("email") == issuer.service_account:
            return _principal(issuer, issuer.kind, issuer.service_account, None)
    return None


def _verify_app_token(token: str, issuer: Ed25519JwtIssuer) -> MachinePrincipal | None:
    public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(issuer.public_key))
    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["EdDSA"],
            audience=issuer.audience,
            issuer=issuer.issuer,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError:
        return None
    if int(claims["exp"]) - int(claims["iat"]) > _MAX_APP_TOKEN_LIFETIME_SECONDS:
        return None
    acting_for = claims.get("act")
    return _principal(
        issuer,
        issuer.kind,
        str(claims["sub"]),
        str(acting_for).strip().lower() if isinstance(acting_for, str) else None,
    )


def _unverified_issuer(token: str) -> str | None:
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None
    issuer = claims.get("iss")
    return issuer if isinstance(issuer, str) else None


def verify_machine_token(token: str, issuers: list[MachineIssuer]) -> MachinePrincipal | None:
    """Return the machine a bearer credential proves, or ``None``.

    The unverified ``iss`` claim only picks which issuer's key to try; every
    accepted token is then fully verified against that issuer's settings.

    Parameters
    ----------
    token : str
        The bearer credential.
    issuers : list[MachineIssuer]
        Issuers declared in ``ATLAS_MACHINE_TRUSTED_ISSUERS``.

    Returns
    -------
    MachinePrincipal | None
        The verified machine, or ``None`` when no declared issuer vouches for it.
    """
    static = [issuer for issuer in issuers if isinstance(issuer, StaticKeyIssuer)]
    principal = _verify_static(token, static)
    if principal is not None:
        return principal
    claimed_issuer = _unverified_issuer(token)
    if claimed_issuer is None:
        return None
    if claimed_issuer in _GOOGLE_ISSUERS:
        google = [issuer for issuer in issuers if isinstance(issuer, GoogleOidcIssuer)]
        return _verify_google(token, google) if google else None
    for issuer in issuers:
        if isinstance(issuer, Ed25519JwtIssuer) and issuer.issuer == claimed_issuer:
            return _verify_app_token(token, issuer)
    return None
