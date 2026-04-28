"""Tests for admin verification API stubs."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api.verification_admin import (
    VerificationUpdateRequest,
    list_verifications,
    update_verification,
)


@pytest.mark.asyncio
async def test_list_verifications_returns_empty_placeholder_response() -> None:
    """The placeholder admin list endpoint returns an empty result set."""
    response = await list_verifications(Response(), status="pending", segment="civic_tech_worker")

    assert response.records == []
    assert response.total == 0
    assert response.status_filter == "pending"
    assert response.segment_filter == "civic_tech_worker"


@pytest.mark.asyncio
async def test_update_verification_raises_not_implemented() -> None:
    """The update endpoint remains explicitly unimplemented."""
    with pytest.raises(HTTPException) as exc_info:
        await update_verification(
            Response(),
            "user-123",
            VerificationUpdateRequest(status="verified", notes="Approved"),
        )

    assert exc_info.value.status_code == HTTPStatus.NOT_IMPLEMENTED
    assert exc_info.value.detail == "Verification updates not yet implemented"
