"""Unified Firehose observation model tests."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.model_observations import (
    evidence_models_from_observation,
    link_signal_observation,
)
from atlas.domains.firehose.models import (
    FirehoseObservationCreate,
    FirehoseObservationCRUD,
    FirehoseSignalCRUD,
    FirehoseSignalQuery,
)
from atlas.domains.firehose.signal_materializer import create_signals_for_observation
from tests.support.schema_introspection import table_exists


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
        assert await table_exists(test_db, table_name), f"expected {table_name} to exist"


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
    assert (
        await link_signal_observation(
            test_db,
            signal_id=signals[0].id,
            observation_id=observation.id,
            role="primary",
        )
        is False
    )


@pytest.mark.asyncio
async def test_orgless_observation_does_not_create_workspace_signal(test_db: object) -> None:
    """Observations without a workspace should stay in the log without leaking to users."""
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="catalog",
            observation_type="source_attached",
            subject_type="source",
            subject_id="source_123",
            org_id=None,
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class="org_website",
            occurred_at=None,
            observed_at="2026-07-07T15:01:00Z",
            dedupe_key="source:orgless",
            public_realm_basis="Public organization website source attached to Atlas record",
            confidence=0.84,
            sensitivity=0.08,
            payload={},
            evidence=[],
        ),
    )

    result = await create_signals_for_observation(test_db, observation_id=observation.id)

    assert result.unchanged is True
    assert result.signals_created == 0


@pytest.mark.asyncio
async def test_materializer_uses_fallback_signal_values_without_routes(
    test_db: object,
) -> None:
    """Workspace observations without coverage targets should still become source-backed signals."""
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="source_target",
            observation_type="watched_source_artifact",
            subject_type="source_target",
            subject_id=None,
            org_id="org_firehose",
            coverage_target_id=None,
            places=["las-vegas-nv"],
            issues=["housing"],
            source_class="org_website",
            occurred_at=None,
            observed_at="2026-07-07T15:01:00Z",
            dedupe_key="source:no-route",
            public_realm_basis="Published public civic source",
            confidence=0.72,
            sensitivity=0.12,
            payload={},
            evidence=[],
        ),
    )

    result = await create_signals_for_observation(test_db, observation_id=observation.id)
    signals = await FirehoseSignalCRUD.list_for_query(
        test_db,
        FirehoseSignalQuery(
            org_id="org_firehose",
            signal_types=["new_source"],
            visibility="workspace",
            limit=10,
        ),
    )

    assert result.routes_created == 0
    assert result.signals_created == 1
    assert signals[0].title == "Watched Source Artifact"
    assert signals[0].summary == "Watched Source Artifact"


@pytest.mark.asyncio
async def test_materializer_rejects_unknown_observation(test_db: object) -> None:
    """Missing observations should produce a precise error before signal writes."""
    with pytest.raises(ValueError, match=r"Unknown Firehose observation\."):
        await create_signals_for_observation(test_db, observation_id="missing_observation")


@pytest.mark.asyncio
async def test_evidence_models_ignore_malformed_stored_evidence(test_db: object) -> None:
    """Malformed evidence blobs should fail closed instead of appearing as confident proof."""
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="catalog",
            observation_type="source_attached",
            subject_type="source",
            subject_id="source_123",
            org_id="org_firehose",
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class="org_website",
            occurred_at=None,
            observed_at="2026-07-07T15:01:00Z",
            dedupe_key="source:malformed-evidence",
            public_realm_basis="Public organization website source attached to Atlas record",
            confidence=0.84,
            sensitivity=0.08,
            payload={},
            evidence=[],
        ),
    )
    non_list_evidence = replace(observation, evidence_json='"not-a-list"')
    mixed_evidence = replace(
        observation,
        evidence_json=json.dumps(
            [
                123,
                {
                    "source_url": "https://example.org",
                    "title": "Example Org",
                    "publisher": "Example Org",
                    "published_at": None,
                    "captured_at": "2026-07-07T15:01:00Z",
                    "passage": "Example Org supports tenants.",
                    "locator": None,
                    "content_hash": "sha256:example-org",
                    "source_class": "org_website",
                },
            ]
        ),
    )

    assert evidence_models_from_observation(non_list_evidence) == []
    assert [
        evidence.source_url for evidence in evidence_models_from_observation(mixed_evidence)
    ] == ["https://example.org"]
