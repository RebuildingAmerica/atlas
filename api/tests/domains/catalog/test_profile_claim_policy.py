"""Tests for profile claim verification policy."""

from __future__ import annotations

from dataclasses import dataclass

from atlas.domains.catalog.services.profile_claims import (
    CLAIM_TIER_EMAIL_DOMAIN,
    CLAIM_TIER_MANUAL_REVIEW,
    ProfileClaimPolicy,
    entry_claim_domains,
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


def test_entry_claim_domains_include_website_and_email_domains() -> None:
    """Organization proof checks compare handles and DNS records to public org domains."""
    entry = _ClaimPolicyEntry(
        type="organization",
        email="hello@mail.mississippirising.org",
        website="https://www.mississippirising.org/about",
    )

    assert entry_claim_domains(entry) == {"mail.mississippirising.org", "mississippirising.org"}


def test_atproto_handle_domain_match_respects_org_domain_boundary() -> None:
    """A branded ATProto handle can support a claim; a generic host cannot."""
    policy = ProfileClaimPolicy()
    entry = _ClaimPolicyEntry(
        type="organization",
        email="info@mississippirising.org",
        website="https://mississippirising.org",
    )

    assert policy.atproto_handle_domain_matches_entry(entry, "news.mississippirising.org") is True
    assert policy.atproto_handle_domain_matches_entry(entry, "@mississippi.bsky.social") is False
