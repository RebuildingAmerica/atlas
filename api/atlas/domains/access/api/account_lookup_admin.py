"""Read-only account and workspace lookup for the platform admin.

Accounts, workspaces and purchases live in the app's database, so the API asks
the app over the callback channel and adds the discount requests it holds
itself. Looking a customer up is sensitive, so it is a POST: every lookup is
written to the audit log under the operator who made it.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import get_usage_db
from atlas.domains.access.membership import app_callback_headers
from atlas.domains.access.models.discount_verifications import DiscountVerificationCRUD
from atlas.platform.authz import Action, PlatformOperator, require_platform_action
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.platform.outbound_http import outbound_http_client

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter(tags=["platform"])

__all__ = ["router"]

LOOKUP_PATH = "/api/auth/internal/platform-lookup"
APP_UNREACHABLE_DETAIL = "The Atlas app could not be asked about this account. Try again."


class AccountLookupRequest(BaseModel):
    """An email address or a workspace slug."""

    query: str = Field(..., min_length=1, max_length=320)


class LookupAccount(BaseModel):
    """The account an email names."""

    id: str
    email: str
    name: str
    email_verified: bool
    created_at: str


class LookupMember(BaseModel):
    """One member of a workspace."""

    email: str
    role: str


class LookupProduct(BaseModel):
    """One product a workspace holds, and where it came from."""

    product: str
    status: str
    granted_at: str
    expires_at: str | None
    purchase_intent_id: str | None = Field(
        description="The purchase that granted it; null for a manual grant."
    )
    stripe_subscription_id: str | None


class LookupPurchase(BaseModel):
    """One checkout the workspace started, and how it ended."""

    id: str
    product: str
    interval: str
    status: str
    created_at: str
    paid_at: str | None
    revoked_at: str | None
    revocation_reason: str | None


class LookupAdjustment(BaseModel):
    """One refund or other money movement."""

    amount: int
    currency: str
    kind: str
    reason: str
    created_at: str


class LookupDiscount(BaseModel):
    """One discount request for the workspace."""

    id: str
    segment: str
    status: str
    submitted_at: str
    notes: str | None


class AppLookupWorkspace(BaseModel):
    """A workspace as the app describes it."""

    id: str
    name: str
    slug: str
    members: list[LookupMember]
    products: list[LookupProduct]
    purchases: list[LookupPurchase]
    adjustments: list[LookupAdjustment]


class LookupWorkspace(AppLookupWorkspace):
    """A workspace with everything needed to answer its owner."""

    discounts: list[LookupDiscount]


class AppLookupAnswer(BaseModel):
    """What the app found."""

    account: LookupAccount | None
    workspaces: list[AppLookupWorkspace]


class AccountLookupResponse(BaseModel):
    """What an email or workspace slug finds."""

    account: LookupAccount | None
    workspaces: list[LookupWorkspace]


async def _ask_app(settings: Settings, query: str) -> AppLookupAnswer:
    url = f"{settings.auth_membership_verification_url.rstrip('/')}{LOOKUP_PATH}"
    async with outbound_http_client(timeout=10.0) as client:
        response = await client.post(
            url, json={"query": query}, headers=app_callback_headers(settings)
        )
    response.raise_for_status()
    return AppLookupAnswer.model_validate(response.json())


@router.post(
    "/api/platform/accounts/lookup",
    response_model=AccountLookupResponse,
    operation_id="lookupAccount",
    summary="Look up an account or workspace",
    description=(
        "Find an account by email, or a workspace by slug, with its members, products and "
        "why it holds them, purchases, refunds and discount requests. Read-only; every "
        "lookup is audited."
    ),
)
async def lookup_account(
    request: AccountLookupRequest,
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    settings: Settings = Depends(get_settings),
    _operator: PlatformOperator = Depends(require_platform_action(Action.ACCOUNTS_READ)),
) -> AccountLookupResponse:
    """Look up an account or workspace."""
    apply_no_store_headers(response)
    try:
        found = await _ask_app(settings, request.query.strip())
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY, detail=APP_UNREACHABLE_DETAIL
        ) from exc
    workspaces: list[LookupWorkspace] = []
    for workspace in found.workspaces:
        records = await DiscountVerificationCRUD.list(conn, organization_id=workspace.id)
        discounts = [
            LookupDiscount(
                id=record.id,
                segment=record.segment,
                status=record.status,
                submitted_at=record.submitted_at,
                notes=record.notes,
            )
            for record in records
        ]
        workspaces.append(LookupWorkspace(**workspace.model_dump(), discounts=discounts))
    return AccountLookupResponse(account=found.account, workspaces=workspaces)
