"""Producer helper tests for the unified Firehose observation log."""

from __future__ import annotations

import pytest

from atlas.domains.firehose.models import FirehoseObservationCRUD
from atlas.domains.firehose.producers import (
    record_catalog_relationship_observation,
    record_catalog_source_observation,
    record_discovery_actor_observation,
    record_profile_claim_observation,
    record_review_decision_observation,
)


@pytest.mark.asyncio
async def test_core_producers_record_civic_observations(test_db: object) -> None:
    """Core Atlas domains should share one observation-writing API."""
    discovery = await record_discovery_actor_observation(
        test_db,
        org_id="org_firehose",
        run_id="run_123",
        entry_id="entry_123",
        entry_name="Example Tenant Center",
        places=["las-vegas-nv"],
        issues=["housing"],
        observed_at="2026-07-07T15:01:00Z",
    )
    source = await record_catalog_source_observation(
        test_db,
        entry_id="entry_123",
        source_id="source_123",
        source_url="https://example.org",
        source_class="org_website",
        summary="Example Tenant Center supports tenants.",
        observed_at="2026-07-07T15:02:00Z",
    )
    relationship = await record_catalog_relationship_observation(
        test_db,
        edge_id="edge_123",
        source_entry_id="entry_123",
        target_entry_id="entry_456",
        relationship_type="member_of",
        source_id="source_123",
        evidence_label="Member organization",
        observed_at="2026-07-07T15:03:00Z",
    )
    claim = await record_profile_claim_observation(
        test_db,
        claim_id="claim_123",
        entry_id="entry_123",
        status="pending",
        observed_at="2026-07-07T15:04:00Z",
    )
    review = await record_review_decision_observation(
        test_db,
        review_item_id="review_123",
        status="approved",
        reviewed_by="reviewer_123",
        observed_at="2026-07-07T15:05:00Z",
    )

    assert discovery.producer == "discovery_sync"
    assert discovery.observation_type == "actor_discovered"
    assert source.producer == "catalog"
    assert source.observation_type == "source_attached"
    assert relationship.observation_type == "relationship_observed"
    assert claim.producer == "profile_claim"
    assert claim.observation_type == "profile_claimed"
    assert review.producer == "review"
    assert review.observation_type == "review_decision"

    duplicate = await record_discovery_actor_observation(
        test_db,
        org_id="org_firehose",
        run_id="run_123",
        entry_id="entry_123",
        entry_name="Duplicate",
        places=["las-vegas-nv"],
        issues=["housing"],
        observed_at="2026-07-07T15:06:00Z",
    )
    stored = await FirehoseObservationCRUD.get_by_id(test_db, discovery.id)

    assert duplicate.id == discovery.id
    assert stored is not None
    assert stored.dedupe_key == "run_123:entry_123"
