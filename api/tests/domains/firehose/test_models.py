"""Firehose persistence model tests."""

from __future__ import annotations

import json

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.models import (
    FirehoseArtifactCreate,
    FirehoseArtifactCRUD,
    FirehoseRouteCreate,
    FirehoseRouteCRUD,
    FirehoseSignalCreate,
    FirehoseSignalCRUD,
    FirehoseSignalQuery,
    FirehoseSourceTargetCreate,
    FirehoseSourceTargetCRUD,
)


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
async def test_firehose_init_db_creates_persistence_tables(test_db: object) -> None:
    """The stored Firehose layer should initialize its source, artifact, signal, and route tables."""
    expected_tables = {
        "firehose_source_targets",
        "firehose_artifacts",
        "firehose_signals",
        "firehose_routes",
    }

    for table_name in expected_tables:
        cursor = await test_db.execute(f"PRAGMA table_info({table_name})")
        columns = [str(row[1]) for row in await cursor.fetchall()]
        assert columns, f"expected {table_name} to exist"


@pytest.mark.asyncio
async def test_source_targets_are_org_scoped_and_idempotent(test_db: object) -> None:
    """A workspace should manage one source target per coverage URL without leaking other orgs."""
    coverage_target_id = await _coverage_target(test_db)

    first = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            label="Housing newsroom RSS",
            url="https://news.example/housing.xml",
            source_kind="rss",
            source_class="local_news",
            places=["las-vegas-nv"],
            issues=["housing"],
            created_by="user_firehose",
            public_route_enabled=True,
        ),
    )
    second = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            label="Updated label",
            url="https://news.example/housing.xml",
            source_kind="rss",
            source_class="local_news",
            places=["las-vegas-nv"],
            issues=["housing"],
            created_by="user_firehose",
            public_route_enabled=True,
        ),
    )

    assert second.id == first.id
    assert second.label == "Updated label"
    assert second.public_route_enabled is True

    visible = await FirehoseSourceTargetCRUD.list_by_org(test_db, org_id="org_firehose")
    hidden = await FirehoseSourceTargetCRUD.list_by_org(test_db, org_id="other_org")

    assert [target.id for target in visible] == [first.id]
    assert hidden == []


@pytest.mark.asyncio
async def test_signals_round_trip_with_routes_and_query_filters(test_db: object) -> None:
    """Stored artifacts should become queryable, source-backed Firehose signals."""
    coverage_target_id = await _coverage_target(test_db)
    target = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            label="Housing newsroom RSS",
            url="https://news.example/housing.xml",
            source_kind="rss",
            source_class="local_news",
            places=["las-vegas-nv"],
            issues=["housing"],
            created_by="user_firehose",
        ),
    )
    artifact = await FirehoseArtifactCRUD.create(
        test_db,
        FirehoseArtifactCreate(
            source_target_id=target.id,
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            source_url="https://news.example/housing-brief",
            canonical_url="https://news.example/housing-brief",
            title="Housing coalition posts public forum",
            publisher="Example News",
            source_kind="rss",
            source_class="local_news",
            published_at="2026-07-07T15:00:00Z",
            detected_at="2026-07-07T15:01:00Z",
            fetched_at="2026-07-07T15:01:03Z",
            content_hash="sha256:housing-forum",
            fingerprint="rss:housing-forum",
            relevant_text="A tenant coalition announced a public forum on rental assistance.",
            raw_content=None,
            http_status=200,
            metadata={"feed_item_id": "housing-forum"},
        ),
    )
    signal = await FirehoseSignalCRUD.create(
        test_db,
        FirehoseSignalCreate(
            artifact_id=artifact.id,
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            signal_type="coalition_activity",
            title="Housing coalition posts public forum",
            summary="A tenant coalition announced a public forum on rental assistance.",
            occurred_at="2026-07-09T01:00:00Z",
            detected_at="2026-07-07T15:01:00Z",
            public_realm_basis="Published local news item",
            places=["las-vegas-nv"],
            issues=["housing"],
            actors=[
                {
                    "id": None,
                    "name": "Tenant Coalition",
                    "type": "organization",
                    "role": "mentioned",
                }
            ],
            confidence=0.78,
            sensitivity=0.12,
            review_state="not_required",
            visibility="workspace",
            route_state="pending",
        ),
    )
    route = await FirehoseRouteCRUD.create(
        test_db,
        FirehoseRouteCreate(
            signal_id=signal.id,
            destination_type="workspace",
            destination_id=coverage_target_id,
            state="active",
            route_reason="Matches watched coverage target",
        ),
    )

    stored = await FirehoseSignalCRUD.list_for_query(
        test_db,
        FirehoseSignalQuery(
            org_id="org_firehose",
            places=["las-vegas-nv"],
            issues=["housing"],
            signal_types=["coalition_activity"],
            source_classes=["local_news"],
            visibility="workspace",
            limit=10,
        ),
    )

    assert len(stored) == 1
    assert stored[0].id == signal.id
    assert stored[0].evidence[0].source_url == "https://news.example/housing-brief"
    assert stored[0].destinations[0].id == route.destination_id
    assert json.loads(stored[0].actors_json)[0]["name"] == "Tenant Coalition"
