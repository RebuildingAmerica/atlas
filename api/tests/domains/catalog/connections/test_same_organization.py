"""Tests for same-organization connection behavior."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections

from .helpers import _actor, _make_org, _make_person


class TestSameOrganization:
    @pytest.mark.asyncio
    async def test_person_surfaces_org_and_coworkers(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Prairie Workers Cooperative")
        person_a = await _make_person(test_db, "Jane Doe", org_id=org_id)
        person_b = await _make_person(test_db, "John Smith", org_id=org_id)

        result = await compute_connections(test_db, person_a)

        org_actor = _actor(result, org_id)
        coworker = _actor(result, person_b)
        assert org_actor is not None
        assert org_actor.reasons[0].label == "Their organization"
        assert coworker is not None
        assert coworker.reasons[0].label == "Also at Prairie Workers Cooperative"

    @pytest.mark.asyncio
    async def test_person_alone_at_org_has_no_coworker(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Solo House")
        person_a = await _make_person(test_db, "Only Member", org_id=org_id)

        result = await compute_connections(test_db, person_a)

        assert result.total == 1
        assert _actor(result, org_id) is not None

    @pytest.mark.asyncio
    async def test_org_surfaces_team(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Affiliating Org")
        person_id = await _make_person(test_db, "Member", org_id=org_id)

        result = await compute_connections(test_db, org_id)

        member = _actor(result, person_id)
        assert member is not None
        assert member.reasons[0].label == "On the team at Affiliating Org"

    @pytest.mark.asyncio
    async def test_org_with_no_team_yields_nothing(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Empty Org")
        result = await compute_connections(test_db, org_id)
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_person_without_org_skips_affiliation(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Unaffiliated")
        result = await compute_connections(test_db, person_a)
        assert result.total == 0
