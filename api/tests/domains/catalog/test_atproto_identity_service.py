"""Tests for ATProto handle/DID freshness checks."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, ClassVar

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.api.profile_claim_atproto_helpers import (
    apply_atproto_claim_proof,
    link_atproto_proof_if_present,
    link_entry_atproto_identity,
)
from atlas.domains.catalog.models.atproto_identities import AtprotoIdentityCRUD
from atlas.domains.catalog.models.atproto_identity_controls import (
    AtprotoIdentityControlConflictError,
    AtprotoIdentityControlCRUD,
)
from atlas.domains.catalog.models.entry_model import _hydrate_atproto_identities
from atlas.domains.catalog.models.profile_atproto_links import (
    ProfileAtprotoLinkConflictError,
    ProfileAtprotoLinkCRUD,
    ProfileAtprotoLinkEvidence,
)
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD
from atlas.domains.catalog.services import atproto_identity
from atlas.domains.catalog.services.atproto_identity import (
    NetworkAtprotoIdentityResolver,
    _did_document_url,
    _resolve_handle_dns,
    _resolve_handle_https,
    _txt_answer_value,
    resolve_current_atproto_identity,
    revalidate_linked_atproto_profiles,
    verify_current_atproto_identity,
    verify_linked_atproto_identity,
)
from atlas.domains.catalog.services.profile_claims import ProfileClaimPolicy
from atlas.models import EntryCRUD


class _Resolver:
    def __init__(self, *, did: str | None, did_doc: dict[str, Any] | None) -> None:
        self.did = did
        self.did_doc = did_doc
        self.handles: list[str] = []
        self.dids: list[str] = []

    async def handle_resolves_to_did(self, handle: str) -> str | None:
        self.handles.append(handle)
        return self.did

    async def did_document(self, did: str) -> dict[str, Any] | None:
        self.dids.append(did)
        return self.did_doc


class _TxtAnswer:
    def __init__(self, value: str | None = None, *, chunks: tuple[bytes, ...] = ()) -> None:
        self.strings = chunks
        self.value = value

    def to_text(self) -> str:
        return self.value or ""


class _FakeDnsResolver:
    def __init__(self, answers: list[_TxtAnswer] | Exception) -> None:
        self.answers = answers
        self.lifetime = 0.0
        self.queries: list[tuple[str, str]] = []

    async def resolve(self, name: str, record_type: str) -> list[_TxtAnswer]:
        self.queries.append((name, record_type))
        if isinstance(self.answers, Exception):
            raise self.answers
        return self.answers


class _FakeHttpResponse:
    def __init__(self, *, status_code: int, text: str = "", payload: object = None) -> None:
        self.status_code = status_code
        self.text = text
        self.payload = payload

    def json(self) -> object:
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class _FakeHttpClient:
    responses: ClassVar[list[_FakeHttpResponse | Exception]] = []
    requests: ClassVar[list[str]] = []

    def __init__(self, **_kwargs: object) -> None:
        pass

    async def __aenter__(self) -> _FakeHttpClient:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def get(self, url: str) -> _FakeHttpResponse:
        self.requests.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


@pytest.mark.asyncio
async def test_global_identity_control_lifecycle_is_independent_from_identity(
    test_db: object,
) -> None:
    identity, control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:person",
        handle="person.example",
        pds_url="https://pds.example",
    )

    assert identity.did == "did:plc:person"
    assert control.status == "active"
    assert await AtprotoIdentityControlCRUD.disconnect(
        test_db, user_id="user_1", identity_id=identity.id
    )
    assert await AtprotoIdentityCRUD.get_by_id(test_db, identity.id) == identity

    refreshed, reconnected = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:person",
        handle="renamed.example",
        pds_url="https://new-pds.example",
    )
    assert refreshed.id == identity.id
    assert refreshed.current_handle == "renamed.example"
    assert reconnected.id == control.id
    assert reconnected.status == "active"


@pytest.mark.asyncio
async def test_second_user_control_conflict_does_not_replace_active_controller(
    test_db: object,
) -> None:
    identity, first = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="user_1",
        did="did:plc:controlled",
        handle="person.example",
    )

    with pytest.raises(AtprotoIdentityControlConflictError):
        await AtprotoIdentityControlCRUD.connect(
            test_db,
            user_id="user_2",
            did=identity.did,
            handle=identity.current_handle,
        )
    with pytest.raises(AtprotoIdentityControlConflictError):
        await AtprotoIdentityControlCRUD.connect(
            test_db,
            user_id="user_2",
            did=identity.did,
            handle=identity.current_handle,
        )

    active = await AtprotoIdentityControlCRUD.get_active_for_identity(test_db, identity.id)
    competing = await AtprotoIdentityControlCRUD.get_for_user_and_identity(
        test_db, user_id="user_2", identity_id=identity.id
    )
    assert active == first
    assert competing is not None
    assert competing.status == "conflict"


@pytest.mark.asyncio
async def test_profile_link_requires_explicit_replacement_and_retains_history(
    test_db: object,
    claimable_org: str,
) -> None:
    first = await AtprotoIdentityCRUD.upsert(test_db, did="did:plc:first", handle="first.example")
    second = await AtprotoIdentityCRUD.upsert(
        test_db, did="did:plc:second", handle="second.example"
    )
    original = await ProfileAtprotoLinkCRUD.attach(
        test_db, entry_id=claimable_org, identity_id=first.id
    )

    with pytest.raises(ProfileAtprotoLinkConflictError):
        await ProfileAtprotoLinkCRUD.attach(test_db, entry_id=claimable_org, identity_id=second.id)

    replacement = await ProfileAtprotoLinkCRUD.attach(
        test_db, entry_id=claimable_org, identity_id=second.id, replace=True
    )
    removed = await ProfileAtprotoLinkCRUD.get_by_id(test_db, original.id)
    assert removed is not None
    assert removed.status == "removed"
    assert replacement.identity_id == second.id
    assert replacement.status == "verified"

    refreshed = await ProfileAtprotoLinkCRUD.attach(
        test_db, entry_id=claimable_org, identity_id=second.id
    )
    assert refreshed.id == replacement.id


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


@pytest.mark.asyncio
async def test_empty_entry_hydration_is_a_noop(test_db: object) -> None:
    assert await _hydrate_atproto_identities(test_db, []) == []


@pytest.mark.asyncio
async def test_atproto_identity_crud_refreshes_existing_identity(test_db: object) -> None:
    created = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:existing",
        handle="old.example",
        pds_url=None,
    )

    refreshed = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:existing",
        handle="new.example",
        pds_url="https://pds.example",
    )

    assert refreshed.id == created.id
    assert refreshed.current_handle == "new.example"
    assert refreshed.pds_url == "https://pds.example"
    assert await AtprotoIdentityCRUD.get_by_id(test_db, "missing") is None
    assert await AtprotoIdentityCRUD.get_by_did(test_db, "did:plc:missing") is None


@pytest.mark.asyncio
async def test_atproto_identity_crud_raises_when_refresh_disappears(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = await AtprotoIdentityCRUD.upsert(
        test_db,
        did="did:plc:vanishing",
        handle="old.example",
    )

    async def fake_get_by_did(*_args: object, **_kwargs: object) -> object:
        return existing

    async def fake_get_by_id(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_did", fake_get_by_did)
    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_id", fake_get_by_id)

    with pytest.raises(RuntimeError, match="disappeared"):
        await AtprotoIdentityCRUD.upsert(
            test_db,
            did="did:plc:vanishing",
            handle="new.example",
        )


@pytest.mark.asyncio
async def test_control_connect_raises_when_created_row_disappears(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def missing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityControlCRUD, "get_by_id", missing)
    with pytest.raises(RuntimeError, match="control disappeared"):
        await AtprotoIdentityControlCRUD.connect(
            test_db,
            user_id="user_1",
            did="did:plc:missing-control",
            handle="missing-control.example",
        )


@pytest.mark.asyncio
async def test_profile_attach_raises_when_created_row_disappears(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db, did="did:plc:missing-link", handle="missing-link.example"
    )

    async def missing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(ProfileAtprotoLinkCRUD, "get_by_id", missing)
    with pytest.raises(RuntimeError, match="profile link disappeared"):
        await ProfileAtprotoLinkCRUD.attach(
            test_db, entry_id=claimable_org, identity_id=identity.id
        )


@pytest.mark.asyncio
async def test_atproto_claim_helpers_reject_missing_or_unbacked_identity(
    test_db: object,
    claimable_org: str,
) -> None:
    entry = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert entry is not None
    actor = SimpleNamespace(user_id="local-operator")
    claim = await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_org,
        user_id="local-operator",
        user_email="operator@atlas.test",
        tier=2,
        evidence={"evidence": "I manage this organization."},
    )

    with pytest.raises(HTTPException) as missing_identity:
        await apply_atproto_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            actor=actor,
            identity_id="missing",
            claim_policy=ProfileClaimPolicy(),
            has_organization_backing=True,
        )
    assert missing_identity.value.status_code == 404
    assert missing_identity.value.detail == "Linked ATProto identity not found."

    identity, _control = await AtprotoIdentityControlCRUD.connect(
        test_db,
        user_id="local-operator",
        did="did:plc:generic",
        handle="mississippi-rising.bsky.social",
        pds_url="https://bsky.social",
    )
    with pytest.raises(HTTPException) as unbacked_identity:
        await apply_atproto_claim_proof(
            test_db,
            claim_id=claim.id,
            entry=entry,
            actor=actor,
            identity_id=identity.id,
            claim_policy=ProfileClaimPolicy(),
            has_organization_backing=False,
        )
    assert unbacked_identity.value.status_code == 400
    assert unbacked_identity.value.detail.startswith("Add the organization domain")


@pytest.mark.asyncio
async def test_link_atproto_proof_ignores_incomplete_or_stale_metadata(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claim = await ProfileClaimCRUD.create(
        test_db,
        entry_id=claimable_org,
        user_id="local-operator",
        user_email="operator@atlas.test",
        tier=2,
        evidence={"evidence": "I manage this organization."},
    )
    incomplete = await ProfileClaimCRUD.record_proof(
        test_db,
        claim_id=claim.id,
        proof_type="atproto",
        proof_status="pending",
        proof_summary="Linked ATProto handle.",
        proof_metadata={"did": "did:plc:generic"},
    )

    await link_atproto_proof_if_present(
        test_db,
        claim.id,
        claimable_org,
        verified_at="2026-07-10T12:00:00Z",
    )

    proofs = await ProfileClaimCRUD.list_proofs(test_db, claim.id)
    assert next(proof for proof in proofs if proof.id == incomplete.id).proof_status == "pending"

    stale = await ProfileClaimCRUD.record_proof(
        test_db,
        claim_id=claim.id,
        proof_type="atproto",
        proof_status="pending",
        proof_summary="Linked ATProto handle.",
        proof_metadata={"identity_id": "missing"},
    )

    async def stale_identity(_handle: str, _did: str) -> bool:
        return False

    monkeypatch.setattr(
        "atlas.domains.catalog.api.profile_claim_atproto_helpers.verify_linked_atproto_identity",
        stale_identity,
    )

    await link_atproto_proof_if_present(
        test_db,
        claim.id,
        claimable_org,
        verified_at="2026-07-10T12:00:00Z",
    )

    proofs = await ProfileClaimCRUD.list_proofs(test_db, claim.id)
    assert next(proof for proof in proofs if proof.id == stale.id).proof_status == "pending"


@pytest.mark.asyncio
async def test_revalidate_linked_atproto_profiles_marks_stale_link_for_attention(
    test_db: object,
    claimable_org: str,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(test_db, did="did:plc:org", handle="org.example")
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        identity_id=identity.id,
        evidence=ProfileAtprotoLinkEvidence(verified_at="2026-07-07T12:00:00Z"),
    )
    await EntryCRUD.update(
        test_db,
        claimable_org,
        claim_status="verified",
        claimed_by_user_id="user_1",
        claim_verified_at="2026-07-07T12:00:00Z",
    )
    resolver = _Resolver(
        did="did:plc:other",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )

    result = await revalidate_linked_atproto_profiles(test_db, resolver=resolver)

    assert result.checked == 1
    assert result.needs_attention == 1
    refreshed = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert refreshed is not None
    assert refreshed.claim_status == "verified"
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.status == "reverification_required"
    stale_identity = await AtprotoIdentityCRUD.get_by_id(test_db, identity.id)
    assert stale_identity is not None
    assert stale_identity.resolution_status == "needs_attention"


@pytest.mark.asyncio
async def test_revalidate_linked_atproto_profiles_keeps_current_public_link(
    test_db: object,
    claimable_org: str,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(test_db, did="did:plc:org", handle="org.example")
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        identity_id=identity.id,
        evidence=ProfileAtprotoLinkEvidence(verified_at="2026-07-07T12:00:00Z"),
    )
    resolver = _Resolver(
        did="did:plc:org",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )

    result = await revalidate_linked_atproto_profiles(test_db, resolver=resolver)

    assert result.checked == 1
    assert result.needs_attention == 0
    link = await ProfileAtprotoLinkCRUD.get_current_for_entry(test_db, claimable_org)
    assert link is not None
    assert link.status == "verified"
    public_identity = await ProfileAtprotoLinkCRUD.get_verified_public_identity(
        test_db, claimable_org
    )
    assert public_identity is not None
    assert public_identity.handle == "org.example"


@pytest.mark.asyncio
async def test_revalidation_skips_orphaned_profile_link(
    test_db: object,
    claimable_org: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = await AtprotoIdentityCRUD.upsert(
        test_db, did="did:plc:orphan", handle="orphan.example"
    )
    await ProfileAtprotoLinkCRUD.attach(test_db, entry_id=claimable_org, identity_id=identity.id)

    async def missing(_conn: object, _identity_id: str) -> None:
        return None

    monkeypatch.setattr(AtprotoIdentityCRUD, "get_by_id", missing)
    result = await revalidate_linked_atproto_profiles(test_db)
    assert result.checked == 0
    assert result.needs_attention == 0
