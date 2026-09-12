"""Guard clauses in the claim helpers, tested where they are raised.

These five rejections were reached only incidentally, by whichever earlier
test in a single large module happened to leave the right state behind.
Splitting that module by concern gave each file its own fixtures and the
incidental coverage went with it, which is the better outcome: a guard worth
keeping is worth asserting directly.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from atlas.domains.access.membership import MembershipResult
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.api import profile_claim_helpers
from atlas.domains.catalog.api.profile_claim_helpers import (
    apply_dns_claim_proof,
    apply_workspace_claim_proof,
    validate_workspace_claim_backing,
    verify_claim_with_entry,
)
from atlas.platform.config import Settings


def _actor(org_id: str | None) -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="user-1",
        email="owner@example.org",
        auth_type="jwt",
        org_id=org_id,
    )


def _membership() -> MembershipResult:
    return MembershipResult(role="admin", slug="team", name="Team", workspace_type="team")


class _Entry:
    """Stands in for a catalog entry carrying claimable domains.

    entry_claim_domains derives the claimable set from the email and website
    fields, so those are what a stub has to supply.
    """

    id = "entry-1"
    type = "organization"
    email = "hello@example.org"
    website = "https://example.org"


class TestVerifyClaimWithEntry:
    @pytest.mark.asyncio
    async def test_reports_a_claim_that_could_not_be_marked_verified(
        self, test_db: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A proof that passes but a claim that will not move is a server fault."""

        async def no_claim(*_args: object, **_kwargs: object) -> None:
            return None

        monkeypatch.setattr(profile_claim_helpers.ProfileClaimCRUD, "mark_verified", no_claim)

        with pytest.raises(HTTPException) as raised:
            await verify_claim_with_entry(
                test_db,
                claim_id="claim-1",
                proof_type="email_domain",
                proof_summary="summary",
                proof_metadata={},
            )

        assert raised.value.status_code == 500


class TestApplyDnsClaimProof:
    @pytest.mark.asyncio
    async def test_rejects_a_domain_the_profile_does_not_list(self, test_db: object) -> None:
        """A claimant cannot prove a domain the profile never mentioned."""
        with pytest.raises(HTTPException) as raised:
            await apply_dns_claim_proof(
                test_db,
                claim_id="claim-1",
                entry=_Entry(),
                domain="unrelated.example",
            )

        assert raised.value.status_code == 400
        assert "not listed" in str(raised.value.detail)


class TestWorkspaceClaimGuards:
    @pytest.mark.asyncio
    async def test_workspace_proof_needs_an_active_workspace(self, test_db: object) -> None:
        """Workspace evidence means nothing without a workspace to attribute it to."""
        with pytest.raises(HTTPException) as raised:
            await apply_workspace_claim_proof(
                test_db,
                claim_id="claim-1",
                entry=_Entry(),
                actor=_actor(None),
                settings=Settings(),
            )

        assert raised.value.status_code == 400

    @pytest.mark.asyncio
    async def test_workspace_proof_needs_verifiable_membership(
        self, test_db: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An unverifiable membership is refused rather than assumed."""

        async def no_membership(*_args: object, **_kwargs: object) -> None:
            return None

        monkeypatch.setattr(profile_claim_helpers, "verify_org_membership", no_membership)

        with pytest.raises(HTTPException) as raised:
            await apply_workspace_claim_proof(
                test_db,
                claim_id="claim-1",
                entry=_Entry(),
                actor=_actor("org-1"),
                settings=Settings(),
            )

        assert raised.value.status_code == 403

    @pytest.mark.asyncio
    async def test_backing_check_needs_an_active_workspace(self) -> None:
        """The preflight refuses before it asks the membership service."""
        with pytest.raises(HTTPException) as raised:
            await validate_workspace_claim_backing(_actor(None), Settings())

        assert raised.value.status_code == 400

    @pytest.mark.asyncio
    async def test_backing_check_refuses_unverifiable_membership(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A workspace that cannot be verified backs no claim."""

        async def no_membership(*_args: object, **_kwargs: object) -> None:
            return None

        monkeypatch.setattr(profile_claim_helpers, "verify_org_membership", no_membership)

        with pytest.raises(HTTPException) as raised:
            await validate_workspace_claim_backing(_actor("org-1"), Settings())

        assert raised.value.status_code == 403

    @pytest.mark.asyncio
    async def test_returns_the_membership_it_verified(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A verified workspace is handed back for the caller to record."""
        membership = _membership()

        async def found(*_args: object, **_kwargs: object) -> Any:
            return membership

        monkeypatch.setattr(profile_claim_helpers, "verify_org_membership", found)

        assert await validate_workspace_claim_backing(_actor("org-1"), Settings()) is membership
