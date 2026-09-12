"""Resolving a DID or handle, and refusing what does not resolve back."""

from __future__ import annotations

from typing import Any

import pytest

from atlas.domains.catalog.services import atproto_identity
from atlas.domains.catalog.services.atproto_identity import (
    NetworkAtprotoIdentityResolver,
    _did_document_url,
    _resolve_handle_dns,
    _resolve_handle_https,
    _txt_answer_value,
    resolve_current_atproto_identity,
    verify_current_atproto_identity,
    verify_linked_atproto_identity,
)
from tests.domains.catalog.atproto_identity_support import (
    _FakeDnsResolver,
    _FakeHttpClient,
    _FakeHttpResponse,
    _Resolver,
    _TxtAnswer,
)


@pytest.mark.asyncio
async def test_did_first_resolution_selects_verified_handle_and_pds() -> None:
    resolver = _Resolver(
        did="did:plc:person",
        did_doc={
            "id": "did:plc:person",
            "alsoKnownAs": ["at://Person.Example"],
            "service": [
                {
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://pds.example",
                }
            ],
        },
    )

    resolution = await resolve_current_atproto_identity("did:plc:person", resolver=resolver)

    assert resolution is not None
    assert resolution.handle == "person.example"
    assert resolution.pds_url == "https://pds.example"


@pytest.mark.asyncio
async def test_verify_current_atproto_identity_requires_bidirectional_match() -> None:
    resolver = _Resolver(
        did="did:plc:org",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )

    verified = await verify_current_atproto_identity(
        "@Org.Example", "did:plc:org", resolver=resolver
    )

    assert verified is True
    assert resolver.handles == ["org.example"]
    assert resolver.dids == ["did:plc:org"]


@pytest.mark.asyncio
async def test_linked_identity_verification_uses_only_explicit_harness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1")
    assert await verify_linked_atproto_identity("Harness.Example", "did:web:harness.example")
    monkeypatch.delenv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS")

    async def verified(_handle: str, _did: str) -> bool:
        return True

    monkeypatch.setattr(atproto_identity, "verify_current_atproto_identity", verified)
    assert await verify_linked_atproto_identity("real.example", "did:plc:real")


@pytest.mark.asyncio
async def test_linked_identity_verification_accepts_managed_pds_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unverified(_handle: str, _did: str) -> bool:
        return False

    monkeypatch.setattr(atproto_identity, "verify_current_atproto_identity", unverified)
    _FakeHttpClient.requests = []
    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, payload={"did": "did:plc:pds"})]
    monkeypatch.setattr(atproto_identity.httpx, "AsyncClient", _FakeHttpClient)

    assert await verify_linked_atproto_identity(
        "Person.PDS.Example",
        "did:plc:pds",
        pds_url="https://pds.example",
    )
    assert _FakeHttpClient.requests == [
        "https://pds.example/xrpc/com.atproto.identity.resolveHandle?handle=person.pds.example"
    ]


@pytest.mark.asyncio
async def test_linked_identity_verification_rejects_invalid_pds_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unverified(_handle: str, _did: str) -> bool:
        return False

    monkeypatch.setattr(atproto_identity, "verify_current_atproto_identity", unverified)
    monkeypatch.setattr(atproto_identity.httpx, "AsyncClient", _FakeHttpClient)

    assert not await verify_linked_atproto_identity("person.example", "did:plc:person")
    assert not await verify_linked_atproto_identity(
        "person.example", "did:plc:person", pds_url="://not-a-url"
    )

    _FakeHttpClient.responses = [atproto_identity.httpx.HTTPError("network")]
    assert not await verify_linked_atproto_identity(
        "person.example", "did:plc:person", pds_url="https://pds.example"
    )

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=500)]
    assert not await verify_linked_atproto_identity(
        "person.example", "did:plc:person", pds_url="https://pds.example"
    )

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, payload=ValueError())]
    assert not await verify_linked_atproto_identity(
        "person.example", "did:plc:person", pds_url="https://pds.example"
    )

    _FakeHttpClient.responses = [
        _FakeHttpResponse(status_code=200, payload={"did": "did:plc:other"})
    ]
    assert not await verify_linked_atproto_identity(
        "person.example", "did:plc:person", pds_url="https://pds.example"
    )


@pytest.mark.asyncio
async def test_verify_current_atproto_identity_rejects_missing_reverse_alias() -> None:
    resolver = _Resolver(
        did="did:plc:org",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://other.example"]},
    )

    verified = await verify_current_atproto_identity(
        "org.example", "did:plc:org", resolver=resolver
    )

    assert verified is False


@pytest.mark.asyncio
async def test_verify_current_atproto_identity_rejects_wrong_did_document() -> None:
    resolver = _Resolver(
        did="did:plc:org",
        did_doc={"id": "did:plc:other", "alsoKnownAs": ["at://org.example"]},
    )

    verified = await verify_current_atproto_identity(
        "org.example", "did:plc:org", resolver=resolver
    )

    assert verified is False


@pytest.mark.asyncio
async def test_verify_current_atproto_identity_rejects_forward_did_mismatch() -> None:
    resolver = _Resolver(
        did="did:plc:other",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )
    assert not await verify_current_atproto_identity(
        "org.example", "did:plc:org", resolver=resolver
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "document",
    [None, {"id": "did:plc:other"}, {"id": "did:plc:org", "alsoKnownAs": "bad"}],
)
async def test_did_first_resolution_rejects_invalid_documents(
    document: dict[str, Any] | None,
) -> None:
    resolver = _Resolver(did="did:plc:org", did_doc=document)
    assert await resolve_current_atproto_identity("did:plc:org", resolver=resolver) is None


@pytest.mark.asyncio
async def test_network_resolver_fetches_did_documents_and_rejects_bad_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _FakeHttpClient.requests = []
    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, payload={"id": "did:plc:org"})]
    monkeypatch.setattr(atproto_identity.httpx, "AsyncClient", _FakeHttpClient)

    resolver = NetworkAtprotoIdentityResolver()

    assert await resolver.did_document("did:plc:org") == {"id": "did:plc:org"}
    assert _FakeHttpClient.requests == ["https://plc.directory/did:plc:org"]

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=404)]
    assert await resolver.did_document("did:plc:missing") is None

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, payload=ValueError())]
    assert await resolver.did_document("did:plc:bad-json") is None

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, payload=["not", "a", "dict"])]
    assert await resolver.did_document("did:plc:list") is None

    _FakeHttpClient.responses = [atproto_identity.httpx.HTTPError("network")]
    assert await resolver.did_document("did:plc:network") is None

    assert await resolver.did_document("did:key:unsupported") is None


@pytest.mark.asyncio
async def test_atproto_handle_resolution_uses_dns_then_https(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dns_resolver = _FakeDnsResolver([_TxtAnswer(chunks=(b"did=did:plc:from-dns",))])
    monkeypatch.setattr(atproto_identity.dns.asyncresolver, "Resolver", lambda: dns_resolver)

    assert await _resolve_handle_dns("org.example") == "did:plc:from-dns"
    assert dns_resolver.queries == [("_atproto.org.example", "TXT")]

    dns_resolver = _FakeDnsResolver([_TxtAnswer('"not-a-did"')])
    monkeypatch.setattr(atproto_identity.dns.asyncresolver, "Resolver", lambda: dns_resolver)
    assert await _resolve_handle_dns("org.example") is None

    dns_resolver = _FakeDnsResolver(atproto_identity.dns.exception.DNSException("no txt"))
    monkeypatch.setattr(atproto_identity.dns.asyncresolver, "Resolver", lambda: dns_resolver)
    assert await _resolve_handle_dns("org.example") is None

    _FakeHttpClient.requests = []
    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, text="did:web:org.example\n")]
    monkeypatch.setattr(atproto_identity.httpx, "AsyncClient", _FakeHttpClient)
    assert await _resolve_handle_https("org.example") == "did:web:org.example"

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=500, text="did:web:org.example")]
    assert await _resolve_handle_https("org.example") is None

    _FakeHttpClient.responses = [atproto_identity.httpx.HTTPError("network")]
    assert await _resolve_handle_https("org.example") is None


@pytest.mark.asyncio
async def test_network_handle_resolver_falls_back_to_https(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_dns(_handle: str) -> None:
        return None

    async def from_https(handle: str) -> str:
        assert handle == "org.example"
        return "did:web:org.example"

    monkeypatch.setattr(atproto_identity, "_resolve_handle_dns", no_dns)
    monkeypatch.setattr(atproto_identity, "_resolve_handle_https", from_https)
    resolver = NetworkAtprotoIdentityResolver()
    assert await resolver.handle_resolves_to_did(" @Org.Example ") == "did:web:org.example"

    _FakeHttpClient.responses = [_FakeHttpResponse(status_code=200, text="not-a-did")]
    assert await _resolve_handle_https("org.example") is None


def test_atproto_identity_helper_branches() -> None:
    assert _did_document_url("did:plc:org") == "https://plc.directory/did:plc:org"
    assert (
        _did_document_url("did:web:sub:example.org")
        == "https://sub/example.org/.well-known/did.json"
    )
    assert _did_document_url("did:key:unknown") is None
    assert _txt_answer_value(_TxtAnswer(chunks=(b"did:", b"plc:org"))) == "did:plc:org"
    assert _txt_answer_value(_TxtAnswer(chunks=(b"\xff",))) is None
    assert _txt_answer_value(_TxtAnswer('"did:plc:text"')) == "did:plc:text"


def test_pds_service_selection_ignores_invalid_entries() -> None:
    assert atproto_identity._pds_url_from_did_document({}) is None
    assert (
        atproto_identity._pds_url_from_did_document(
            {
                "service": [
                    "bad",
                    {"type": "Other", "serviceEndpoint": "https://other.example"},
                    {"type": "AtprotoPersonalDataServer", "serviceEndpoint": 42},
                ]
            }
        )
        is None
    )
