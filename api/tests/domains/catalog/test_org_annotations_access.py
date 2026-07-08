"""Tests for org-scoped annotation HTTP endpoints."""

from __future__ import annotations

import pytest

STATUS_BAD_REQUEST = 400
STATUS_FORBIDDEN = 403

ORG_ID = "local"
OTHER_ORG_ID = "other-org"


class TestOrgAnnotationsAccess:
    """Org access guard for annotation endpoints."""

    @pytest.mark.asyncio
    async def test_list_rejects_wrong_org(self, test_client: object) -> None:
        """Listing annotations for a different org should return 403."""
        response = await test_client.get(f"/api/orgs/{OTHER_ORG_ID}/annotations")
        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_create_without_capability_returns_403(
        self,
        no_notes_capability_client: object,
    ) -> None:
        """Creating an annotation without workspace.notes capability returns 403."""
        response = await no_notes_capability_client.post(
            f"/api/orgs/{ORG_ID}/annotations",
            json={"entry_id": "any-id", "content": "test"},
        )
        assert response.status_code == STATUS_FORBIDDEN
