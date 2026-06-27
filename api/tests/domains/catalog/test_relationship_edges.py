"""Tests for sourced actor relationships and stable identity keys."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.catalog.models.source import SourceCRUD

HIGH_IDENTITY_CONFIDENCE = 0.96
UPDATED_EDGE_CONFIDENCE = 0.91
REPEATED_EVIDENCE_COUNT = 2


async def _make_actor(conn: Any, name: str, *, entry_type: str = "organization") -> str:
    return await EntryCRUD.create(
        conn,
        entry_type=entry_type,
        name=name,
        description=f"{name} profile",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )


async def _make_source(conn: Any, url: str = "https://example.com/source") -> str:
    return await SourceCRUD.create(
        conn,
        url=url,
        source_type="government_record",
        extraction_method="manual",
        title="Public filing",
        publication="State filing portal",
        published_date=date(2026, 6, 1),
    )


@pytest.mark.asyncio
async def test_identity_key_resolves_repeated_mentions_to_existing_actor(test_db: object) -> None:
    actor_id = await _make_actor(test_db, "River City Mutual Aid")
    source_id = await _make_source(test_db)

    await RelationshipCRUD.upsert_identity_key(
        test_db,
        entry_id=actor_id,
        key_type="domain",
        key_value="https://www.rivercityaid.org/about",
        source_id=source_id,
        confidence=0.92,
    )

    resolved = await RelationshipCRUD.resolve_identity_key(
        test_db,
        key_type="domain",
        key_value="rivercityaid.org",
    )

    assert resolved == actor_id


@pytest.mark.asyncio
async def test_repeated_identity_key_updates_confidence_and_source(test_db: object) -> None:
    actor_id = await _make_actor(test_db, "Prairie Civic Fund")
    first_source_id = await _make_source(test_db, "https://example.com/first")
    second_source_id = await _make_source(test_db, "https://example.com/second")

    await RelationshipCRUD.upsert_identity_key(
        test_db,
        entry_id=actor_id,
        key_type="ein",
        key_value="12-3456789",
        source_id=first_source_id,
        confidence=0.7,
    )
    await RelationshipCRUD.upsert_identity_key(
        test_db,
        entry_id=actor_id,
        key_type="ein",
        key_value="123456789",
        source_id=second_source_id,
        confidence=HIGH_IDENTITY_CONFIDENCE,
    )

    key = await RelationshipCRUD.get_identity_key(test_db, key_type="ein", key_value="12-3456789")

    assert key is not None
    assert key.entry_id == actor_id
    assert key.key_value == "123456789"
    assert key.source_id == second_source_id
    assert key.confidence == HIGH_IDENTITY_CONFIDENCE


@pytest.mark.asyncio
async def test_sourced_edge_strengthens_when_same_source_repeats(test_db: object) -> None:
    source_actor_id = await _make_actor(test_db, "KC Tenants")
    target_actor_id = await _make_actor(test_db, "Missouri Housing Alliance")
    source_id = await _make_source(test_db)

    first_edge_id = await RelationshipCRUD.upsert_edge(
        test_db,
        source_entry_id=source_actor_id,
        target_entry_id=target_actor_id,
        relationship_type="coalition_partner",
        source_id=source_id,
        evidence_label="Joint tenant protections campaign",
        confidence=0.82,
    )
    second_edge_id = await RelationshipCRUD.upsert_edge(
        test_db,
        source_entry_id=source_actor_id,
        target_entry_id=target_actor_id,
        relationship_type="coalition_partner",
        source_id=source_id,
        evidence_label="Joint tenant protections campaign",
        confidence=UPDATED_EDGE_CONFIDENCE,
    )

    edges = await RelationshipCRUD.list_edges_for_entry(test_db, source_actor_id)

    assert second_edge_id == first_edge_id
    assert len(edges) == 1
    edge = edges[0]
    assert edge.evidence_count == REPEATED_EVIDENCE_COUNT
    assert edge.confidence == UPDATED_EDGE_CONFIDENCE
    assert edge.target_entry_id == target_actor_id
    assert edge.source_id == source_id


@pytest.mark.asyncio
async def test_edges_are_direction_agnostic_for_profile_networks(test_db: object) -> None:
    person_id = await _make_actor(test_db, "Maya Lee", entry_type="person")
    org_id = await _make_actor(test_db, "Neighborhood Legal Center")
    source_id = await _make_source(test_db)

    await RelationshipCRUD.upsert_edge(
        test_db,
        source_entry_id=person_id,
        target_entry_id=org_id,
        relationship_type="staff",
        source_id=source_id,
        evidence_label="Staff profile",
        confidence=0.9,
    )

    edges = await RelationshipCRUD.list_edges_for_entry(test_db, org_id)

    assert len(edges) == 1
    assert edges[0].source_entry_id == person_id
    assert edges[0].target_entry_id == org_id
