"""Tests for sourced relationship edges."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.relationships import RelationshipCRUD

from .helpers import _actor, _co_mention, _make_org, _make_person


class TestSourcedEdges:
    @pytest.mark.asyncio
    async def test_sourced_relationship_edge_is_a_profile_connection(self, test_db: object) -> None:
        person_id = await _make_person(test_db, "Maya Lee")
        org_id = await _make_org(test_db, "Neighborhood Legal Center")
        source_id = await _co_mention(test_db, [person_id], publication="State Bar")
        await RelationshipCRUD.upsert_edge(
            test_db,
            source_entry_id=person_id,
            target_entry_id=org_id,
            relationship_type="staff",
            source_id=source_id,
            evidence_label="Staff profile",
            confidence=1.0,
        )

        result = await compute_connections(test_db, org_id)

        actor = _actor(result, person_id)
        assert actor is not None
        assert actor.score == 6.0
        assert actor.reasons[0].kind == "sourced_edge"
        assert actor.reasons[0].relationship_type == "staff"
        assert actor.reasons[0].label == "Staff profile"
        assert actor.reasons[0].count == 1
        assert actor.reasons[0].source_id == source_id

    @pytest.mark.asyncio
    async def test_inactive_relationship_target_is_skipped(self, test_db: object) -> None:
        """Inactive linked actors should not appear in the connection graph."""
        person_id = await _make_person(test_db, "Maya Lee")
        org_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Inactive Neighborhood Legal Center",
            description="Inactive profile.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=False,
        )
        source_id = await _co_mention(test_db, [person_id], publication="State Bar")
        await RelationshipCRUD.upsert_edge(
            test_db,
            source_entry_id=person_id,
            target_entry_id=org_id,
            relationship_type="staff",
            source_id=source_id,
            evidence_label="Inactive profile",
            confidence=1.0,
        )

        result = await compute_connections(test_db, person_id)

        assert result.total == 0
