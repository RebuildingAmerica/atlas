"""Tests for ranking and output shape."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections

from .helpers import _actor, _co_mention, _make_org, _make_person


class TestRankingAndShape:
    @pytest.mark.asyncio
    async def test_ranked_by_strength_and_normalized(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Anchor Org")
        person_a = await _make_person(test_db, "Center", org_id=org_id)
        strong = await _make_person(test_db, "Strong Tie", org_id=org_id)
        weak = await _make_person(test_db, "Weak Tie")
        await _co_mention(test_db, [person_a, weak], publication=None)

        result = await compute_connections(test_db, person_a)

        top = result.actors[0]
        assert top.id in {org_id, strong}
        assert top.strength == 100
        assert top.tier == "strong"
        weak_actor = _actor(result, weak)
        assert weak_actor is not None
        assert weak_actor.strength == 40
        assert weak_actor.tier == "moderate"
        assert weak_actor.evidence == weak_actor.reasons[0].label

    @pytest.mark.asyncio
    async def test_evidence_is_strongest_reason(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Shared Org")
        person_a = await _make_person(test_db, "Center", org_id=org_id)
        both = await _make_person(test_db, "Both Ties", org_id=org_id)
        await _co_mention(test_db, [person_a, both], publication="Local Paper")

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, both)
        assert actor is not None
        assert actor.reasons[0].kind == "same_organization"
        assert actor.evidence == "Also at Shared Org"
        assert any(r.kind == "co_mentioned" for r in actor.reasons)

    @pytest.mark.asyncio
    async def test_total_and_pagination(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Big Org")
        person_a = await _make_person(test_db, "Center", org_id=org_id)
        for index in range(3):
            await _make_person(test_db, f"Member {index}", org_id=org_id)

        full = await compute_connections(test_db, person_a)
        assert full.total == 4

        page = await compute_connections(test_db, person_a, limit=2, offset=0)
        assert len(page.actors) == 2
        assert page.total == 4

        tail = await compute_connections(test_db, person_a, limit=2, offset=2)
        assert len(tail.actors) == 2
        assert page.actors[0].id != tail.actors[0].id
