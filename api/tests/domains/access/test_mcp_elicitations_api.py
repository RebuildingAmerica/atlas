"""Tests for first-party MCP elicitation completion endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api.mcp_elicitations import complete_mcp_url_elicitation
from atlas.domains.access.principals import AuthenticatedActor
from atlas.platform.mcp.elicitation import create_url_elicitation_state, get_url_elicitation_state

HTTP_NOT_FOUND = 404


def _actor(*, user_id: str = "user_1", org_id: str | None = "org_1") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id=user_id,
        email=f"{user_id}@example.com",
        auth_type="session",
        org_id=org_id,
    )


@pytest.mark.asyncio
async def test_completion_finishes_match() -> None:
    state = create_url_elicitation_state(
        user_id="user_1",
        org_id="org_1",
        target_flow="billing_settings",
        target_url="/account",
    )
    response = Response()

    completed = await complete_mcp_url_elicitation(
        state.elicitation_id,
        response,
        _actor(),
    )

    assert completed.status == "completed"
    assert completed.elicitation_id == state.elicitation_id
    assert completed.target_flow == "billing_settings"
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_completion_hides_mismatch() -> None:
    state = create_url_elicitation_state(
        user_id="user_1",
        org_id="org_1",
        target_flow="billing_settings",
        target_url="/account",
    )

    with pytest.raises(HTTPException) as exc_info:
        await complete_mcp_url_elicitation(
            state.elicitation_id,
            Response(),
            _actor(user_id="user_2"),
        )

    assert exc_info.value.status_code == HTTP_NOT_FOUND
    assert exc_info.value.detail == "MCP elicitation not found."


@pytest.mark.asyncio
async def test_completion_hides_unknown_id() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await complete_mcp_url_elicitation(
            "eli_unknown",
            Response(),
            _actor(),
        )

    assert exc_info.value.status_code == HTTP_NOT_FOUND
    assert exc_info.value.detail == "MCP elicitation not found."


@pytest.mark.asyncio
async def test_completion_hides_expired_id() -> None:
    state = create_url_elicitation_state(
        user_id="user_1",
        org_id="org_1",
        target_flow="billing_settings",
        target_url="/account",
        now=datetime(2000, 1, 1, tzinfo=UTC),
    )

    with pytest.raises(HTTPException) as exc_info:
        await complete_mcp_url_elicitation(
            state.elicitation_id,
            Response(),
            _actor(),
        )

    assert exc_info.value.status_code == HTTP_NOT_FOUND
    assert exc_info.value.detail == "MCP elicitation not found."


@pytest.mark.asyncio
async def test_completion_hides_reused_id() -> None:
    state = create_url_elicitation_state(
        user_id="user_1",
        org_id="org_1",
        target_flow="billing_settings",
        target_url="/account",
    )

    completed = await complete_mcp_url_elicitation(
        state.elicitation_id,
        Response(),
        _actor(),
    )

    with pytest.raises(HTTPException) as exc_info:
        await complete_mcp_url_elicitation(
            completed.elicitation_id,
            Response(),
            _actor(),
        )

    assert exc_info.value.status_code == HTTP_NOT_FOUND
    assert exc_info.value.detail == "MCP elicitation not found."


@pytest.mark.asyncio
async def test_completion_hides_tampered_id() -> None:
    state = create_url_elicitation_state(
        user_id="user_1",
        org_id="org_1",
        target_flow="billing_settings",
        target_url="/account",
    )

    with pytest.raises(HTTPException) as exc_info:
        await complete_mcp_url_elicitation(
            f"{state.elicitation_id}x",
            Response(),
            _actor(),
        )

    assert exc_info.value.status_code == HTTP_NOT_FOUND
    assert exc_info.value.detail == "MCP elicitation not found."
    assert get_url_elicitation_state(state.elicitation_id) == state
