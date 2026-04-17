"""Moderation API tests."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_flag_creation_rejects_missing_entities_and_sources(test_client: object) -> None:
    """Anonymous flag routes should 404 when the target record is missing."""
    entity_response = await test_client.post(
        "/api/entity-flags",
        json={
            "entity_id": "missing-entity",
            "reason": "stale_information",
            "note": "Could not verify this record.",
        },
    )
    source_response = await test_client.post(
        "/api/source-flags",
        json={
            "source_id": "missing-source",
            "reason": "broken_link",
            "note": "The source no longer resolves.",
        },
    )

    assert entity_response.status_code == 404  # noqa: PLR2004
    assert source_response.status_code == 404  # noqa: PLR2004
