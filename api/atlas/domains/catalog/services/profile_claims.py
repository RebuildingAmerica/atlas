"""Policy services for profile claims and verification proofs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

CLAIM_TIER_EMAIL_DOMAIN = 1
CLAIM_TIER_MANUAL_REVIEW = 2
EMAIL_DOMAIN_VERIFIABLE_ENTRY_TYPES = frozenset({"organization"})
_WWW_PREFIX = "www."


class ClaimPolicyEntry(Protocol):
    """Entry fields needed by profile-claim policy decisions."""

    type: str
    email: str | None
    website: str | None


@dataclass(frozen=True, slots=True)
class ProfileClaimDecision:
    """Claim classification returned by ProfileClaimPolicy."""

    tier: int
    requires_manual_evidence: bool


@dataclass(frozen=True, slots=True)
class ProfileClaimEmailDomainProof:
    """Email-domain proof details for a low-risk organization claim."""

    proof_type: str
    summary: str
    metadata: dict[str, object]


class ProfileClaimPolicy:
    """Classify profile claims and build verification proof metadata."""

    def classify(self, entry: ClaimPolicyEntry, user_email: str | None) -> ProfileClaimDecision:
        """Return the claim tier for a user/entry pair."""
        if self.email_domain_proof(entry, user_email) is not None:
            return ProfileClaimDecision(
                tier=CLAIM_TIER_EMAIL_DOMAIN,
                requires_manual_evidence=False,
            )
        return ProfileClaimDecision(
            tier=CLAIM_TIER_MANUAL_REVIEW,
            requires_manual_evidence=True,
        )

    def email_domain_proof(
        self,
        entry: ClaimPolicyEntry,
        user_email: str | None,
    ) -> ProfileClaimEmailDomainProof | None:
        """Return proof metadata when email-domain verification is allowed."""
        user_email_domain = _domain_of(user_email)
        entry_domains = _entry_email_domains(entry)
        if (
            entry.type not in EMAIL_DOMAIN_VERIFIABLE_ENTRY_TYPES
            or user_email_domain is None
            or user_email_domain not in entry_domains
        ):
            return None

        return ProfileClaimEmailDomainProof(
            proof_type="email_domain",
            summary=f"Verified email control for {user_email_domain}.",
            metadata={
                "entry_domains": sorted(entry_domains),
                "user_email_domain": user_email_domain,
            },
        )


def _domain_of(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if "@" in cleaned:
        cleaned = cleaned.rsplit("@", 1)[1]
    parsed = urlparse(cleaned if "://" in cleaned else f"https://{cleaned}")
    host = (parsed.hostname or cleaned).lower()
    if host.startswith(_WWW_PREFIX):
        host = host[len(_WWW_PREFIX) :]
    return host


def _entry_email_domains(entry: ClaimPolicyEntry) -> set[str]:
    """Return domains derivable from a profile's email and website fields."""
    domains: set[str] = set()
    email_domain = _domain_of(entry.email)
    if email_domain:
        domains.add(email_domain)
    website_domain = _domain_of(entry.website)
    if website_domain:
        domains.add(website_domain)
    return domains
