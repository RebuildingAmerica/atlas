"""ATProto identity resolution for profile verification."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, cast

import dns.asyncresolver
import dns.exception
import httpx

from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.profile_atproto_links import ProfileAtprotoLinkCRUD

if TYPE_CHECKING:
    import aiosqlite

ATPROTO_IDENTITY_TIMEOUT_SECONDS = 5.0
ATPROTO_HANDLE_TXT_PREFIX = "did="
PLC_DIRECTORY_BASE_URL = "https://plc.directory"


class AtprotoIdentityResolver(Protocol):
    """Resolver capable of checking a handle/DID pair against current ATProto identity."""

    async def handle_resolves_to_did(self, handle: str) -> str | None:
        """Return the DID currently advertised by ``handle``."""

    async def did_document(self, did: str) -> dict[str, Any] | None:
        """Return the DID document for ``did``."""


@dataclass(frozen=True, slots=True)
class NetworkAtprotoIdentityResolver:
    """Resolve ATProto handles and DIDs from DNS/HTTPS authority."""

    async def handle_resolves_to_did(self, handle: str) -> str | None:
        """Return the DID currently advertised by ``handle``."""
        normalized = _normalize_handle(handle)
        return await _resolve_handle_dns(normalized) or await _resolve_handle_https(normalized)

    async def did_document(self, did: str) -> dict[str, Any] | None:
        """Return the DID document for ``did``."""
        url = _did_document_url(did)
        if url is None:
            return None
        async with httpx.AsyncClient(timeout=ATPROTO_IDENTITY_TIMEOUT_SECONDS) as client:
            try:
                response = await client.get(url)
            except httpx.HTTPError:
                return None
        if response.status_code != httpx.codes.OK:
            return None
        try:
            payload = response.json()
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None


@dataclass(frozen=True, slots=True)
class AtprotoProfileRevalidationResult:
    """Counts from one linked-profile ATProto freshness pass."""

    checked: int
    needs_attention: int


@dataclass(frozen=True, slots=True)
class AtprotoIdentityResolution:
    """A bidirectionally verified current DID resolution."""

    did: str
    handle: str
    pds_url: str | None


async def verify_current_atproto_identity(
    handle: str,
    did: str,
    *,
    resolver: AtprotoIdentityResolver | None = None,
) -> bool:
    """Return whether ``handle`` currently resolves to ``did`` and back."""
    active_resolver = resolver or NetworkAtprotoIdentityResolver()
    normalized_handle = _normalize_handle(handle)
    resolved_did = await active_resolver.handle_resolves_to_did(normalized_handle)
    if resolved_did != did:
        return False
    did_doc = await active_resolver.did_document(did)
    if did_doc is None or did_doc.get("id") != did:
        return False
    also_known_as = did_doc.get("alsoKnownAs")
    return isinstance(also_known_as, list) and f"at://{normalized_handle}" in also_known_as


async def resolve_current_atproto_identity(
    did: str,
    *,
    resolver: AtprotoIdentityResolver | None = None,
) -> AtprotoIdentityResolution | None:
    """Resolve a DID document, select its ATProto handle, and verify it forward."""
    active_resolver = resolver or NetworkAtprotoIdentityResolver()
    did_doc = await active_resolver.did_document(did)
    if did_doc is None or did_doc.get("id") != did:
        return None
    aliases = did_doc.get("alsoKnownAs")
    if not isinstance(aliases, list):
        return None
    handles = [
        _normalize_handle(alias.removeprefix("at://"))
        for alias in aliases
        if isinstance(alias, str) and alias.startswith("at://")
    ]
    for handle in handles:
        if await active_resolver.handle_resolves_to_did(handle) != did:
            continue
        return AtprotoIdentityResolution(
            did=did,
            handle=handle,
            pds_url=_pds_url_from_did_document(did_doc),
        )
    return None


async def revalidate_linked_atproto_profiles(
    conn: aiosqlite.Connection,
    *,
    resolver: AtprotoIdentityResolver | None = None,
) -> AtprotoProfileRevalidationResult:
    """Refresh linked DIDs while retaining provenance when resolution fails."""
    links = await ProfileAtprotoLinkCRUD.list_current(conn)
    checked = 0
    needs_attention = 0
    for link in links:
        identity = await AtprotoIdentityCRUD.get_by_id(conn, link.identity_id)
        if identity is None:
            continue
        checked += 1
        resolution = await resolve_current_atproto_identity(identity.did, resolver=resolver)
        if resolution is not None:
            await AtprotoIdentityCRUD.upsert(
                conn,
                did=resolution.did,
                handle=resolution.handle,
                pds_url=resolution.pds_url,
            )
            await ProfileAtprotoLinkCRUD.mark_verified(conn, link.id)
            continue
        await AtprotoIdentityCRUD.mark_needs_attention(
            conn, identity.id, error="Current DID and handle could not be verified."
        )
        await ProfileAtprotoLinkCRUD.mark_needs_attention(conn, link.id)
        needs_attention += 1
    await conn.commit()
    return AtprotoProfileRevalidationResult(checked=checked, needs_attention=needs_attention)


async def _resolve_handle_dns(handle: str) -> str | None:
    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = ATPROTO_IDENTITY_TIMEOUT_SECONDS
    try:
        answers = await resolver.resolve(f"_atproto.{handle}", "TXT")
    except dns.exception.DNSException:
        return None
    for answer in answers:
        value = _txt_answer_value(answer)
        if value and value.startswith(ATPROTO_HANDLE_TXT_PREFIX):
            return value.removeprefix(ATPROTO_HANDLE_TXT_PREFIX).strip()
    return None


async def _resolve_handle_https(handle: str) -> str | None:
    url = f"https://{handle}/.well-known/atproto-did"
    async with httpx.AsyncClient(timeout=ATPROTO_IDENTITY_TIMEOUT_SECONDS) as client:
        try:
            response = await client.get(url)
        except httpx.HTTPError:
            return None
    if response.status_code != httpx.codes.OK:
        return None
    value = response.text.strip()
    return value if value.startswith("did:") else None


def _did_document_url(did: str) -> str | None:
    if did.startswith("did:plc:"):
        return f"{PLC_DIRECTORY_BASE_URL}/{did}"
    if did.startswith("did:web:"):
        domain = did.removeprefix("did:web:").replace(":", "/")
        return f"https://{domain}/.well-known/did.json"
    return None


def _txt_answer_value(answer: Any) -> str | None:
    chunks = getattr(answer, "strings", ())
    if chunks:
        try:
            return "".join(chunk.decode("utf-8") for chunk in chunks).strip().strip('"')
        except UnicodeDecodeError:
            return None
    return cast("str", answer.to_text()).strip().strip('"')


def _normalize_handle(handle: str) -> str:
    return handle.strip().removeprefix("@").lower()


def _pds_url_from_did_document(document: dict[str, Any]) -> str | None:
    services = document.get("service")
    if not isinstance(services, list):
        return None
    for service in services:
        if not isinstance(service, dict):
            continue
        if service.get("type") != "AtprotoPersonalDataServer":
            continue
        endpoint = service.get("serviceEndpoint")
        if isinstance(endpoint, str):
            return endpoint
    return None
