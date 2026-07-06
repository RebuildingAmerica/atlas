"""Tests for profile claim persistence."""
# ruff: noqa: PLR2004, SLF001

from __future__ import annotations

import pytest

from atlas.domains.catalog.models import profile_claims
from atlas.domains.catalog.models.profile_claims import ProfileClaimCRUD


class TestProfileClaimCRUD:
    """Direct model-level coverage for ProfileClaimCRUD."""

    @pytest.mark.asyncio
    async def test_create_tier_one_issues_token_and_expiry(
        self, test_db: object, claimable_org: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        assert claim.status == "pending"
        assert claim.tier == 1
        assert claim.verification_token is not None
        assert claim.verification_token_expires_at is not None

    @pytest.mark.asyncio
    async def test_create_tier_two_does_not_issue_token(
        self, test_db: object, claimable_person: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_person,
            user_id="user-1",
            user_email="marcus@example.org",
            tier=2,
            evidence={"linkedin": "https://linkedin.com/in/marcus"},
        )
        assert claim.tier == 2
        assert claim.verification_token is None
        assert claim.evidence == {"linkedin": "https://linkedin.com/in/marcus"}

    @pytest.mark.asyncio
    async def test_mark_verified_clears_token_and_sets_timestamp(
        self, test_db: object, claimable_org: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        verified = await ProfileClaimCRUD.mark_verified(test_db, claim.id)
        assert verified is not None
        assert verified.status == "verified"
        assert verified.verified_at is not None
        assert verified.verification_token is None

    @pytest.mark.asyncio
    async def test_record_and_list_proofs_preserves_metadata(
        self, test_db: object, claimable_org: str
    ) -> None:
        """Proof artifacts should round-trip metadata and optional timestamps."""
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=2,
            evidence={"note": "I work here."},
        )
        without_metadata = await ProfileClaimCRUD.record_proof(
            test_db,
            claim_id=claim.id,
            proof_type="manual_review",
            proof_status="pending",
            proof_summary="Awaiting staff review.",
        )
        with_metadata = await ProfileClaimCRUD.record_proof(
            test_db,
            claim_id=claim.id,
            proof_type="manual_review",
            proof_status="verified",
            proof_summary="Reviewed by staff.",
            proof_metadata={"reviewer": "staff"},
            reviewed_at="2026-07-04T00:00:00+00:00",
            expires_at="2027-07-04T00:00:00+00:00",
        )

        proofs = await ProfileClaimCRUD.list_proofs(test_db, claim.id)

        assert without_metadata.metadata is None
        assert with_metadata.metadata == {"reviewer": "staff"}
        assert {proof.id for proof in proofs} == {without_metadata.id, with_metadata.id}
        listed = {proof.id: proof for proof in proofs}
        assert listed[with_metadata.id].metadata == {"reviewer": "staff"}
        assert listed[with_metadata.id].reviewed_at == "2026-07-04T00:00:00+00:00"
        assert listed[with_metadata.id].expires_at == "2027-07-04T00:00:00+00:00"

    @pytest.mark.asyncio
    async def test_mark_verified_can_build_default_email_domain_proof_summary(
        self, test_db: object, claimable_org: str
    ) -> None:
        """Email-domain proof metadata should produce a useful default summary."""
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )

        verified = await ProfileClaimCRUD.mark_verified(
            test_db,
            claim.id,
            proof_type="email_domain",
            proof_metadata={"user_email_domain": "mississippirising.org"},
        )
        proofs = await ProfileClaimCRUD.list_proofs(test_db, claim.id)

        assert verified is not None
        assert proofs[0].proof_summary == "Verified email control for mississippirising.org."

    def test_default_verified_proof_summary_falls_back_without_domain(self) -> None:
        """Email-domain proofs without a real domain should stay generic."""
        assert (
            profile_claims._default_verified_proof_summary(
                "email_domain",
                {"user_email_domain": ""},
            )
            == "Verified by reviewer decision."
        )

    @pytest.mark.asyncio
    async def test_mark_rejected_records_reason(
        self, test_db: object, claimable_person: str
    ) -> None:
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_person,
            user_id="user-1",
            user_email="marcus@example.org",
            tier=2,
            evidence={"note": "I am Marcus."},
        )
        rejected = await ProfileClaimCRUD.mark_rejected(test_db, claim.id, reason="cannot verify")
        assert rejected is not None
        assert rejected.status == "rejected"
        assert rejected.rejected_reason == "cannot verify"

    @pytest.mark.asyncio
    async def test_evidence_returns_none_when_no_payload(
        self, test_db: object, claimable_org: str
    ) -> None:
        """ProfileClaimModel.evidence should be None when no evidence_json was stored."""
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        assert claim.evidence is None

    @pytest.mark.asyncio
    async def test_get_by_id_returns_none_when_missing(self, test_db: object) -> None:
        """get_by_id should return None when the claim id is unknown."""
        assert await ProfileClaimCRUD.get_by_id(test_db, "no-such-id") is None

    @pytest.mark.asyncio
    async def test_list_by_user_returns_empty_when_user_has_no_claims(
        self, test_db: object
    ) -> None:
        """list_by_user should return an empty list when the user has no claims."""
        assert await ProfileClaimCRUD.list_by_user(test_db, "phantom-user") == []

    @pytest.mark.asyncio
    async def test_list_by_entry_returns_all_claims_newest_first(
        self, test_db: object, claimable_org: str
    ) -> None:
        """list_by_entry should return every claim made against an entry, newest first."""
        first = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-a",
            user_email="a@mississippirising.org",
            tier=1,
        )
        second = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-b",
            user_email="b@mississippirising.org",
            tier=1,
        )
        claims = await ProfileClaimCRUD.list_by_entry(test_db, claimable_org)
        assert {claim.id for claim in claims} == {first.id, second.id}

    @pytest.mark.asyncio
    async def test_list_by_entry_returns_empty_when_no_claims(
        self, test_db: object, claimable_person: str
    ) -> None:
        """list_by_entry should return an empty list when no claims exist."""
        assert await ProfileClaimCRUD.list_by_entry(test_db, claimable_person) == []

    @pytest.mark.asyncio
    async def test_get_active_for_entry_returns_none_when_no_active_claim(
        self, test_db: object, claimable_org: str
    ) -> None:
        """get_active_for_entry should return None when no pending or verified claim exists."""
        assert await ProfileClaimCRUD.get_active_for_entry(test_db, claimable_org) is None

    @pytest.mark.asyncio
    async def test_mark_verified_returns_none_for_missing_claim(self, test_db: object) -> None:
        """mark_verified should return None when no claim row matches the id."""
        assert await ProfileClaimCRUD.mark_verified(test_db, "no-such-claim") is None

    @pytest.mark.asyncio
    async def test_mark_rejected_returns_none_for_missing_claim(self, test_db: object) -> None:
        """mark_rejected should return None when no claim row matches the id."""
        assert await ProfileClaimCRUD.mark_rejected(test_db, "no-such-claim", reason="x") is None

    @pytest.mark.asyncio
    async def test_revoke_transitions_verified_claim_to_revoked(
        self, test_db: object, claimable_org: str
    ) -> None:
        """revoke should flip a verified claim to revoked and record the reason."""
        claim = await ProfileClaimCRUD.create(
            test_db,
            entry_id=claimable_org,
            user_id="user-1",
            user_email="alice@mississippirising.org",
            tier=1,
        )
        verified = await ProfileClaimCRUD.mark_verified(test_db, claim.id)
        assert verified is not None
        revoked = await ProfileClaimCRUD.revoke(test_db, claim.id, reason="user request")
        assert revoked is not None
        assert revoked.status == "revoked"
        assert revoked.rejected_reason == "user request"

    @pytest.mark.asyncio
    async def test_revoke_returns_none_for_missing_claim(self, test_db: object) -> None:
        """revoke should return None when the claim id doesn't exist."""
        assert await ProfileClaimCRUD.revoke(test_db, "no-such-claim", reason="x") is None
