"""Tests for org-scoped annotation HTTP endpoints."""

from __future__ import annotations

import pytest

STATUS_CREATED = 201
STATUS_BAD_REQUEST = 400
STATUS_NOT_FOUND = 404

ORG_ID = "local"


class TestOrgAnnotationsCreate:
    """POST /api/orgs/{org_id}/annotations"""

    @pytest.mark.asyncio
    async def test_create_annotation(
        self,
        capable_test_client: object,
        sample_entry_for_annotation: str,
    ) -> None:
        """Creating an annotation with capability should return 201 with the annotation."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"entry_id": sample_entry_for_annotation, "content": "Great org!"},
        )
        assert response.status_code == STATUS_CREATED
        data = response.json()
        assert data["content"] == "Great org!"
        assert data["entry_id"] == sample_entry_for_annotation
        assert data["org_id"] == ORG_ID

    @pytest.mark.asyncio
    async def test_create_annotation_with_missing_entry_returns_404(
        self,
        capable_test_client: object,
    ) -> None:
        """Creating an annotation for a nonexistent entry should return 404."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"entry_id": "nonexistent-entry-id", "content": "Note"},
        )
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_create_source_annotation(
        self,
        capable_test_client: object,
        sample_source_for_annotation: str,
    ) -> None:
        """Creating an annotation for a source packet should return a source-targeted note."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"source_id": sample_source_for_annotation, "content": "Key quote for follow-up."},
        )

        assert response.status_code == STATUS_CREATED
        data = response.json()
        assert data["content"] == "Key quote for follow-up."
        assert data["target_type"] == "source"
        assert data["target_id"] == sample_source_for_annotation
        assert data["source_id"] == sample_source_for_annotation

    @pytest.mark.asyncio
    async def test_create_annotation_with_missing_source_returns_404(
        self,
        capable_test_client: object,
    ) -> None:
        """Creating an annotation for a nonexistent source should return 404."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"source_id": "nonexistent-source-id", "content": "Note"},
        )
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_create_annotation_requires_exactly_one_target(
        self,
        capable_test_client: object,
        sample_entry_for_annotation: str,
        sample_source_for_annotation: str,
    ) -> None:
        """A private note must target one entry or one source, never both."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={
                "entry_id": sample_entry_for_annotation,
                "source_id": sample_source_for_annotation,
                "content": "Ambiguous note.",
            },
        )

        assert response.status_code == STATUS_BAD_REQUEST
