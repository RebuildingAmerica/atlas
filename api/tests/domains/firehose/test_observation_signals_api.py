"""Internal REST API tests for Firehose observation signals."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.models import FirehoseObservationCreate, FirehoseObservationCRUD


async def _coverage_target(test_db: object) -> str:
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id="local",
        name="Las Vegas housing watch",
        geography="Las Vegas, NV",
        issue_areas=["housing"],
        actor_types=["organization"],
        source_types=["rss"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="local-operator",
    )
    return target.id


async def _observation(test_db: object) -> str:
    coverage_target_id = await _coverage_target(test_db)
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id="entry_123",
            org_id="local",
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
    return observation.id


@pytest.mark.asyncio
async def test_post_observation_signals_creates_signal_resource(
    test_client: object,
    test_db: object,
) -> None:
    """The internal API should create signals from an observation without RPC naming."""
    observation_id = await _observation(test_db)

    response = await test_client.post(
        f"/api/internal/firehose/observations/{observation_id}/signals"
    )

    assert response.status_code == HTTPStatus.CREATED
    body = response.json()
    assert body["observation_id"] == observation_id
    assert body["signals_created"] == 1
    assert body["routes_created"] == 1
    assert body["unchanged"] is False


@pytest.mark.asyncio
async def test_post_observation_signals_is_idempotent(
    test_client: object,
    test_db: object,
) -> None:
    """Repeated signal creation for the same observation should not duplicate feed items."""
    observation_id = await _observation(test_db)

    first = await test_client.post(f"/api/internal/firehose/observations/{observation_id}/signals")
    second = await test_client.post(f"/api/internal/firehose/observations/{observation_id}/signals")

    assert first.status_code == HTTPStatus.CREATED
    assert second.status_code == HTTPStatus.OK
    assert second.json()["signals_created"] == 0
    assert second.json()["unchanged"] is True
