"""Editorial activity: the instance's audit log, for the people who run it."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from atlas.domains.access import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)
from atlas.domains.moderation.api import get_db
from atlas.platform.authz import Action, AuditEntry, AuditLogCRUD, require_action
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter()

__all__ = ["router"]

INSTANCE_NAMESPACE = "instance."
"""Only instance decisions are shown; platform decisions belong to the platform admin."""

_CURSOR_SEPARATOR = "|"
BAD_CURSOR_DETAIL = "That page of activity does not exist."


class AuditEntryResponse(BaseModel):
    """One decision, allowed or refused."""

    id: str = Field(..., description="Entry ID")
    occurred_at: str = Field(..., description="When it was decided")
    actor_id: str = Field(..., description="Who acted")
    actor_email: str | None = Field(None, description="The actor's email, when they have one")
    action: str = Field(..., description="The action attempted, such as instance.claims.review")
    allowed: bool = Field(..., description="Whether it was allowed")
    status_code: int = Field(..., description="The status the decision produced")
    method: str = Field(..., description="HTTP method")
    route: str = Field(..., description="Route template")
    target: dict[str, str] = Field(..., description="Route parameters naming what was acted on")
    reason: str | None = Field(None, description="Why it was refused")


class AuditPageResponse(BaseModel):
    """A page of decisions, newest first."""

    items: list[AuditEntryResponse] = Field(..., description="Decisions on this page")
    next_before: str | None = Field(
        None, description="Pass as `before` for the next, older page; null on the last page"
    )


def _cursor_for(entry: AuditEntry) -> str:
    return f"{entry.occurred_at}{_CURSOR_SEPARATOR}{entry.id}"


def _parse_cursor(value: str | None) -> tuple[str, str] | None:
    if value is None:
        return None
    occurred_at, separator, entry_id = value.rpartition(_CURSOR_SEPARATOR)
    if not separator or not occurred_at or not entry_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=BAD_CURSOR_DETAIL)
    return occurred_at, entry_id


@router.get(
    "/audit-log",
    response_model=AuditPageResponse,
    summary="List editorial activity",
    description=(
        "Every editorial decision on this instance that changed data, or tried to, newest "
        "first, from the append-only audit log."
    ),
    operation_id="listEditorialActivity",
    tags=["moderation"],
)
async def list_editorial_activity(
    response: Response,
    limit: int = Query(50, ge=1, le=200),
    before: str | None = Query(None, description="`next_before` from the previous page"),
    actor: AuthenticatedActor = Depends(require_action(Action.AUDIT_READ)),
    db: aiosqlite.Connection = Depends(get_db),
) -> AuditPageResponse:
    """Return one page of editorial activity."""
    _ = actor
    entries = await AuditLogCRUD.list_namespace_page(
        db, namespace=INSTANCE_NAMESPACE, limit=limit + 1, before=_parse_cursor(before)
    )
    page = entries[:limit]
    apply_no_store_headers(response)
    return AuditPageResponse(
        items=[AuditEntryResponse.model_validate(entry, from_attributes=True) for entry in page],
        next_before=_cursor_for(page[-1]) if len(entries) > limit else None,
    )
