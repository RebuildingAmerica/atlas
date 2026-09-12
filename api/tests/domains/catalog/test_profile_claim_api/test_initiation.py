"""Starting a claim, and the tier the evidence earns."""

# ruff: noqa: PLR2004

from __future__ import annotations

import pytest

from atlas.models import EntryCRUD


async def _valid_atproto_identity(_handle: str, _did: str) -> bool:
    return True


class TestProfileClaimAPI:
    """End-to-end API tests for the claim flow."""

    @pytest.mark.asyncio
    async def test_initiate_claim_tier_one_uses_email_domain_match(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        # With no accounts the build_local_actor returns a fixed email; so we
        # construct a tier-1 entry whose email domain matches that local actor.
        # The default local actor email is "operator@atlas.test" — adjust the
        # entry to match for this test.
        await EntryCRUD.update(test_db, claimable_org, email="info@atlas.rebuildingus.org")
        resp = await test_client.post(
            f"/api/profiles/{(await EntryCRUD.get_by_id(test_db, claimable_org)).slug}/claim",
            json={},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == 1
        assert body["status"] == "pending"

        # Entry's claim_status flips to pending and records claimed_by_user_id
        entry = await EntryCRUD.get_by_id(test_db, claimable_org)
        assert entry is not None
        assert entry.claim_status == "pending"
        assert entry.claimed_by_user_id is not None

    @pytest.mark.asyncio
    async def test_initiate_claim_tier_two_requires_evidence(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug
        resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert resp.status_code == 400

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim", json={"evidence": "I am Marcus, see linkedin."}
        )
        assert resp.status_code == 201
        assert resp.json()["tier"] == 2

    @pytest.mark.asyncio
    async def test_initiate_person_claim_stays_manual_even_with_matching_email_domain(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        """Person claims never auto-verify from email-domain proof alone."""
        await EntryCRUD.update(
            test_db,
            claimable_person,
            email="marcus@atlas.rebuildingus.org",
            website="https://atlas.rebuildingus.org/marcus",
        )
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug

        missing_evidence_resp = await test_client.post(f"/api/profiles/{slug}/claim", json={})
        assert missing_evidence_resp.status_code == 400

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={"evidence": "Official bio confirms I am Marcus."},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["tier"] == 2

    @pytest.mark.asyncio
    async def test_initiate_claim_stores_structured_subject_intent(
        self, test_client: object, test_db: object, claimable_person: str
    ) -> None:
        slug = (await EntryCRUD.get_by_id(test_db, claimable_person)).slug

        resp = await test_client.post(
            f"/api/profiles/{slug}/claim",
            json={
                "relationship": "self",
                "evidence": "My staff page lists this work.",
                "requested_changes": "Use my current organization and remove an old title.",
                "preferred_contact_channel": "form",
                "private_note": "Do not publish my direct email.",
            },
        )

        assert resp.status_code == 201, resp.text
        evidence = resp.json()["evidence"]
        assert evidence == {
            "relationship": "self",
            "evidence": "My staff page lists this work.",
            "requested_changes": "Use my current organization and remove an old title.",
            "preferred_contact_channel": "form",
            "private_note": "Do not publish my direct email.",
        }
