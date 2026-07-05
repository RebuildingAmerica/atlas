"""Tests for profile claim verification policy."""

from __future__ import annotations

from dataclasses import dataclass

from atlas.domains.catalog.services.profile_claims import (
    CLAIM_TIER_EMAIL_DOMAIN,
    CLAIM_TIER_MANUAL_REVIEW,
    ProfileClaimPolicy,
)


@dataclass(frozen=True)
class _ClaimPolicyEntry:
    """Minimal entry shape consumed by ProfileClaimPolicy."""

    type: str
    email: str | None
    website: str | None


def test_claim_policy_allows_email_domain_for_organization_profiles() -> None:
    """Low-risk organization claims can use same-domain email proof."""
    policy = ProfileClaimPolicy()
    entry = _ClaimPolicyEntry(
        type="organization",
        email="info@atlas.rebuildingus.org",
        website="https://atlas.rebuildingus.org",
    )

    decision = policy.classify(entry, "operator@atlas.rebuildingus.org")
    proof = policy.email_domain_proof(entry, "operator@atlas.rebuildingus.org")

    assert decision.tier == CLAIM_TIER_EMAIL_DOMAIN
    assert decision.requires_manual_evidence is False
    assert proof is not None
    assert proof.summary == "Verified email control for atlas.rebuildingus.org."
    assert proof.metadata == {
        "entry_domains": ["atlas.rebuildingus.org"],
        "user_email_domain": "atlas.rebuildingus.org",
    }


def test_claim_policy_keeps_person_profiles_in_manual_review() -> None:
    """A matching email domain is not enough to auto-verify a real person."""
    policy = ProfileClaimPolicy()
    entry = _ClaimPolicyEntry(
        type="person",
        email="marcus@atlas.rebuildingus.org",
        website="https://atlas.rebuildingus.org/marcus",
    )

    decision = policy.classify(entry, "operator@atlas.rebuildingus.org")

    assert decision.tier == CLAIM_TIER_MANUAL_REVIEW
    assert decision.requires_manual_evidence is True
    assert policy.email_domain_proof(entry, "operator@atlas.rebuildingus.org") is None
