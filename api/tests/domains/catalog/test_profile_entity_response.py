"""Tests for profile entity response fields and source filtering."""
# ruff: noqa: PLR2004

from __future__ import annotations

import json

import pytest

from atlas.models import EntryCRUD, SourceCRUD


class TestSuppressedSourcesFiltering:
    """Suppressed sources should not surface in the public detail response."""

    @pytest.mark.asyncio
    async def test_suppressed_source_excluded_from_detail(
        self, test_client: object, test_db: object, claimable_org: str
    ) -> None:
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.com/sup",
            source_type="news_article",
            extraction_method="manual",
            title="Suppressed",
        )
        await test_db.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) "
            "VALUES (?, ?, CURRENT_TIMESTAMP)",
            (claimable_org, source_id),
        )
        await test_db.commit()

        # Confirm the source appears in the public detail before suppression.
        detail = await test_client.get(f"/api/entities/{claimable_org}")
        assert detail.status_code == 200
        ids = {source["id"] for source in detail.json()["sources"]}
        assert source_id in ids

        # Suppress it directly via the model.
        await EntryCRUD.update(
            test_db,
            claimable_org,
            suppressed_source_ids=[source_id],
        )

        # Confirm the source is gone from the public detail.
        detail2 = await test_client.get(f"/api/entities/{claimable_org}")
        assert detail2.status_code == 200
        ids2 = {source["id"] for source in detail2.json()["sources"]}
        assert source_id not in ids2


class TestEntityResponseFreshFields:
    """Verify the EntityResponse exposes the new fields."""

    @pytest.mark.asyncio
    async def test_response_includes_claim_block(
        self, test_client: object, claimable_org: str
    ) -> None:
        resp = await test_client.get(f"/api/entities/{claimable_org}")
        assert resp.status_code == 200
        body = resp.json()
        assert "claim" in body
        assert body["claim"]["status"] == "unclaimed"
        assert body["claim"]["verification_level"] == "source-derived"
        assert body["custom_bio"] is None
        assert body["photo_url"] is None
        # Ensure the JSON is well-formed by re-encoding.
        assert json.dumps(body)
