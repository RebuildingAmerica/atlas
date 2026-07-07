"""MCP elicitation completion endpoints for first-party Atlas web flows."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict

from atlas.domains.access.dependencies import require_actor
from atlas.platform.mcp.elicitation import complete_url_elicitation_state

if TYPE_CHECKING:
    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter(tags=["access"])


class McpElicitationCompleteResponse(BaseModel):
    """Response returned when a browser flow completes an MCP URL elicitation."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["completed"]
    elicitation_id: str
    target_flow: str


@router.post(
    "/mcp/elicitations/{elicitation_id}/complete",
    response_model=McpElicitationCompleteResponse,
    status_code=status.HTTP_200_OK,
)
async def complete_mcp_url_elicitation(
    elicitation_id: str,
    response: Response,
    actor: AuthenticatedActor = Depends(require_actor),
) -> McpElicitationCompleteResponse:
    """Complete a URL-mode MCP elicitation after first-party identity verification."""
    completed = await complete_url_elicitation_state(
        elicitation_id,
        user_id=actor.user_id,
        org_id=actor.org_id,
    )
    if completed is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="MCP elicitation not found.",
        )

    response.headers["Cache-Control"] = "no-store"
    return McpElicitationCompleteResponse(
        status="completed",
        elicitation_id=completed.elicitation_id,
        target_flow=completed.target_flow,
    )
