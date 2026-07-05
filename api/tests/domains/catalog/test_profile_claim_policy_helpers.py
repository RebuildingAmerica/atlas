"""Tests for profile claim policy helper edge cases."""

from __future__ import annotations

from types import SimpleNamespace

from atlas.domains.catalog.services.profile_claims import (
    CLAIM_TIER_MANUAL_REVIEW,
    ProfileClaimPolicy,
)


class TestDomainOfHelper:
    """Direct edge cases for the email/website domain extractor."""

    def test_returns_none_for_whitespace_only_value(self) -> None:
        entry = SimpleNamespace(type="organization", email="info@example.com", website=None)
        decision = ProfileClaimPolicy().classify(entry, "   ")

        assert decision.tier == CLAIM_TIER_MANUAL_REVIEW

    def test_strips_www_prefix(self) -> None:
        entry = SimpleNamespace(
            type="organization",
            email=None,
            website="https://www.example.com",
        )
        proof = ProfileClaimPolicy().email_domain_proof(entry, "owner@example.com")

        assert proof is not None
        assert proof.metadata["user_email_domain"] == "example.com"
