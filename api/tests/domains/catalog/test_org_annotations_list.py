"""Tests for org-scoped annotation HTTP endpoints."""

from __future__ import annotations

import pytest

STATUS_OK = 200
STATUS_BAD_REQUEST = 400
ORG_ID = "local"


class TestOrgAnnotationsList:
    """GET /api/orgs/{org_id}/annotations"""

    @pytest.mark.asyncio
    async def test_list_returns_empty_initially(self, test_client: object) -> None:
        """An org with no annotations should return an empty list."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        assert response.status_code == STATUS_OK
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_list_returns_seeded_annotations(
        self,
        test_client: object,
        sample_annotation_id: str,
    ) -> None:
        """Seeded annotations should appear in the list response."""
        response = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        assert response.status_code == STATUS_OK
        items = response.json()
        assert any(a["id"] == sample_annotation_id for a in items)

    @pytest.mark.asyncio
    async def test_list_filtered_by_entry_id(
        self,
        test_client: object,
        sample_annotation_id: str,
    ) -> None:
        """entry_id query param should filter annotations to that entry."""
        all_resp = await test_client.get(f"/api/orgs/{ORG_ID}/annotations")
        seeded = next(a for a in all_resp.json() if a["id"] == sample_annotation_id)
        target_entry_id = seeded["entry_id"]

        filtered = await test_client.get(
            f"/api/orgs/{ORG_ID}/annotations",
            params={"entry_id": target_entry_id},
        )
        assert filtered.status_code == STATUS_OK
        items = filtered.json()
        assert all(a["entry_id"] == target_entry_id for a in items)
        assert any(a["id"] == sample_annotation_id for a in items)

    @pytest.mark.asyncio
    async def test_list_filtered_by_source_id(
        self,
        capable_test_client: object,
        sample_source_for_annotation: str,
    ) -> None:
        """source_id query param should filter private notes to that source packet."""
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"source_id": sample_source_for_annotation, "content": "Quote this source."},
        )
        assert create_response.status_code == STATUS_OK + 1

        filtered = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/annotations",
            params={"source_id": sample_source_for_annotation},
        )

        assert filtered.status_code == STATUS_OK
        items = filtered.json()
        assert len(items) == 1
        assert items[0]["target_type"] == "source"
        assert items[0]["target_id"] == sample_source_for_annotation
        assert items[0]["source_id"] == sample_source_for_annotation

    @pytest.mark.asyncio
    async def test_list_rejects_ambiguous_filters(
        self,
        test_client: object,
        sample_entry_for_annotation: str,
        sample_source_for_annotation: str,
    ) -> None:
        """The API should keep note filtering targeted to one evidence surface."""
        response = await test_client.get(
            f"/api/orgs/{ORG_ID}/annotations",
            params={
                "entry_id": sample_entry_for_annotation,
                "source_id": sample_source_for_annotation,
            },
        )

        assert response.status_code == STATUS_BAD_REQUEST
