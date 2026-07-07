"""Unified Firehose observation model tests."""

from __future__ import annotations

import json

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.models import (
    FirehoseObservationCreate,
    FirehoseObservationCRUD,
    FirehoseSignalCRUD,
    FirehoseSignalQuery,
)
from atlas.domains.firehose.signal_materializer import create_signals_for_observation


async def _coverage_target(test_db: object, org_id: str = "org_firehose") -> str:
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id=org_id,
        name="Las Vegas housing watch",
        geography="Las Vegas, NV",
        issue_areas=["housing"],
        actor_types=["organization"],
        source_types=["rss"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="user_firehose",
    )
    return target.id


@pytest.mark.asyncio
async def test_firehose_init_db_creates_observation_tables(test_db: object) -> None:
    """Firehose should have a platform-wide observation log before signals."""
    expected_tables = {
        "firehose_observations",
        "firehose_signal_observations",
    }

    for table_name in expected_tables:
        cursor = await test_db.execute(f"PRAGMA table_info({table_name})")
        columns = [str(row[1]) for row in await cursor.fetchall()]
        assert columns, f"expected {table_name} to exist"


@pytest.mark.asyncio
async def test_observations_are_append_only_and_deduped_by_producer_key(
    test_db: object,
) -> None:
    """Repeated producer delivery should point at one observation resource."""
    coverage_target_id = await _coverage_target(test_db)

    first = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id="entry_123",
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            places=["las-vegas-nv"],
            issues=["housing"],
            source_class="discovery_run",
            occurred_at="2026-07-07T15:00:00Z",
            observed_at="2026-07-07T15:01:00Z",
            dedupe_key="discovery-run-1:entry_123",
            public_realm_basis="Source-backed Scout discovery result",
            confidence=0.81,
            sensitivity=0.1,
            payload={"title": "New housing organization found"},
            evidence=[
                {
                    "source_url": "https://example.org/about",
                    "title": "About Example Org",
                    "publisher": "Example Org",
                    "published_at": None,
                    "captured_at": "2026-07-07T15:01:00Z",
                    "passage": "Example Org works on tenant support.",
                    "locator": None,
                    "content_hash": "sha256:example-org",
                    "source_class": "org_website",
                }
            ],
        ),
    )
    second = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id="entry_123",
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            places=["las-vegas-nv"],
            issues=["housing"],
            source_class="discovery_run",
            occurred_at="2026-07-07T15:00:00Z",
            observed_at="2026-07-07T15:02:00Z",
            dedupe_key="discovery-run-1:entry_123",
            public_realm_basis="Source-backed Scout discovery result",
            confidence=0.81,
            sensitivity=0.1,
            payload={"title": "Duplicate delivery"},
            evidence=[],
        ),
    )

    assert second.id == first.id
    assert first.status == "observed"
    assert json.loads(first.payload_json)["title"] == "New housing organization found"


@pytest.mark.asyncio
async def test_observation_creates_user_facing_signal_once(test_db: object) -> None:
    """A civic observation should create an idempotent signal resource."""
    coverage_target_id = await _coverage_target(test_db)
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id="entry_123",
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            places=["las-vegas-nv"],
            issues=["housing"],
            source_class="discovery_run",
            occurred_at="2026-07-07T15:00:00Z",
            observed_at="2026-07-07T15:01:00Z",
            dedupe_key="discovery-run-1:entry_123",
            public_realm_basis="Source-backed Scout discovery result",
            confidence=0.81,
            sensitivity=0.1,
            payload={
                "title": "New housing organization found",
                "summary": "Example Org was found working on tenant support.",
            },
            evidence=[
                {
                    "source_url": "https://example.org/about",
                    "title": "About Example Org",
                    "publisher": "Example Org",
                    "published_at": None,
                    "captured_at": "2026-07-07T15:01:00Z",
                    "passage": "Example Org works on tenant support.",
                    "locator": None,
                    "content_hash": "sha256:example-org",
                    "source_class": "org_website",
                }
            ],
        ),
    )

    first = await create_signals_for_observation(test_db, observation_id=observation.id)
    second = await create_signals_for_observation(test_db, observation_id=observation.id)

    signals = await FirehoseSignalCRUD.list_for_query(
        test_db,
        FirehoseSignalQuery(
            org_id="org_firehose",
            places=["las-vegas-nv"],
            issues=["housing"],
            signal_types=["actor_discovered"],
            source_classes=["org_website"],
            visibility="workspace",
            limit=10,
        ),
    )

    assert first.signals_created == 1
    assert first.routes_created == 1
    assert second.signals_created == 0
    assert second.unchanged is True
    assert len(signals) == 1
    assert signals[0].title == "New housing organization found"
    assert signals[0].evidence[0].source_url == "https://example.org/about"
    assert signals[0].destinations[0].type == "workspace"
