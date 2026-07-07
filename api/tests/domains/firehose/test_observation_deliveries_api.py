"""Internal message-delivery tests for Firehose observations."""

from __future__ import annotations

import base64
import json
from http import HTTPStatus

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.bus import (
    INVALID_OBSERVATION_DELIVERY_MESSAGE,
    parse_observation_delivery,
)
from atlas.domains.firehose.models import FirehoseObservationCreate, FirehoseObservationCRUD


async def _observation(test_db: object) -> str:
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
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="catalog",
            observation_type="source_attached",
            subject_type="source",
            subject_id="source_123",
            org_id="local",
            coverage_target_id=target.id,
            places=["las-vegas-nv"],
            issues=["housing"],
            source_class="org_website",
            occurred_at="2026-07-07T15:00:00Z",
            observed_at="2026-07-07T15:01:00Z",
            dedupe_key="entry_123:source_123",
            public_realm_basis="Public organization website source attached to Atlas record",
            confidence=0.84,
            sensitivity=0.08,
            payload={
                "title": "Organization website attached",
                "summary": "A public website source was attached to a housing actor.",
            },
            evidence=[
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
                }
            ],
        ),
    )
    return observation.id


def _delivery_payload(observation_id: str) -> dict[str, object]:
    data = base64.b64encode(json.dumps({"observation_id": observation_id}).encode()).decode()
    return {
        "message": {
            "data": data,
            "messageId": "msg-123",
            "publishTime": "2026-07-07T15:01:02Z",
        },
        "subscription": "projects/atlas/subscriptions/firehose-observations",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"message": "not-a-dict"},
        {"message": {"data": 123}},
        _delivery_payload(""),
    ],
)
def test_parse_observation_delivery_rejects_ambiguous_envelopes(
    payload: dict[str, object],
) -> None:
    """Malformed bus envelopes should fail before any signal work starts."""
    with pytest.raises(ValueError, match=INVALID_OBSERVATION_DELIVERY_MESSAGE):
        parse_observation_delivery(payload)


def test_parse_observation_delivery_returns_observation_id() -> None:
    """A valid message envelope should expose only the stored observation id."""
    delivery = parse_observation_delivery(_delivery_payload("obs_123"))

    assert delivery.observation_id == "obs_123"


@pytest.mark.asyncio
async def test_post_observation_delivery_creates_signal_resource(
    test_client: object,
    test_db: object,
) -> None:
    """Pub/Sub push should create a delivery resource, not expose an RPC primitive."""
    observation_id = await _observation(test_db)

    response = await test_client.post(
        "/api/internal/firehose/observation-deliveries",
        json=_delivery_payload(observation_id),
    )

    assert response.status_code == HTTPStatus.CREATED
    body = response.json()
    assert body["observation_id"] == observation_id
    assert body["signals_created"] == 1
    assert body["routes_created"] == 1


@pytest.mark.asyncio
async def test_post_observation_delivery_rejects_malformed_message(
    test_client: object,
) -> None:
    """Malformed bus deliveries should fail without creating ambiguous signals."""
    response = await test_client.post(
        "/api/internal/firehose/observation-deliveries",
        json={"message": {"data": "not-base64"}},
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["detail"] == "Invalid Firehose observation delivery."
