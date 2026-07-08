"""Tests for ATProto handle/DID freshness checks."""

from __future__ import annotations

from typing import Any

import pytest

from atlas.domains.catalog.api.profile_claim_atproto_helpers import link_entry_atproto_identity
from atlas.domains.catalog.services.atproto_identity import (
    revalidate_linked_atproto_profiles,
    verify_current_atproto_identity,
)
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
async def test_revalidate_linked_atproto_profiles_clears_stale_public_link(
    test_db: object,
    claimable_org: str,
) -> None:
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        did="did:plc:org",
        handle="org.example",
        verified_at="2026-07-07T12:00:00Z",
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
    assert result.cleared == 1
    refreshed = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert refreshed is not None
    assert refreshed.claim_status == "verified"
    assert refreshed.linked_atproto_handle is None
    assert refreshed.linked_atproto_did is None
    assert refreshed.linked_atproto_verified_at is None


@pytest.mark.asyncio
async def test_revalidate_linked_atproto_profiles_keeps_current_public_link(
    test_db: object,
    claimable_org: str,
) -> None:
    await link_entry_atproto_identity(
        test_db,
        claimable_org,
        did="did:plc:org",
        handle="org.example",
        verified_at="2026-07-07T12:00:00Z",
    )
    resolver = _Resolver(
        did="did:plc:org",
        did_doc={"id": "did:plc:org", "alsoKnownAs": ["at://org.example"]},
    )

    result = await revalidate_linked_atproto_profiles(test_db, resolver=resolver)

    assert result.checked == 1
    assert result.cleared == 0
    refreshed = await EntryCRUD.get_by_id(test_db, claimable_org)
    assert refreshed is not None
    assert refreshed.linked_atproto_handle == "org.example"
