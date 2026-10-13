"""Protect applicants' private details and invitation decisions with platform authority.

The app owns retained requests, purchases and delivery. This narrow callback
preserves those records while the platform guard audits the verified operator.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from atlas.domains.access.membership import app_callback_headers
from atlas.platform.authz import Action, PlatformOperator, require_platform_action
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers
from atlas.platform.outbound_http import outbound_http_client

router = APIRouter(tags=["platform"])
CALLBACK_PATH = "/api/auth/internal/platform-waitlist"
# Fifty recipients use ten workers and two bounded 10-second attempts each:
# five waves need up to 100 seconds, plus durable writes and transport margin.
WAITLIST_CALLBACK_TIMEOUT_SECONDS = 150.0
APP_UNREACHABLE_DETAIL = "Waitlist requests could not be loaded or changed. Try again."


class WaitlistModel(BaseModel):
    """The app's existing camel-case waitlist contract."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class WaitlistRequest(WaitlistModel):
    """An applicant's retained request."""

    id: str
    email: str
    name: str
    organization: str
    intended_use: str
    product: Literal["atlas_pro", "atlas_team", "atlas_research_pass"]
    interval: str | None
    status: Literal["unconfirmed", "waiting", "invited", "withdrawn", "revoked"]
    created_at: str
    confirmed_at: str | None
    invited_at: str | None
    purchased_at: str | None


class WaitlistDelivery(WaitlistModel):
    """One durable email delivery."""

    id: str
    request_id: str
    kind: Literal["confirm", "manage", "invite"]
    status: Literal["pending", "sending", "sent", "failed", "unresolved"]
    provider_id: str | None
    created_at: str
    updated_at: str
    attempts: int


class WaitlistEvent(WaitlistModel):
    """A request decision attributed to its operator."""

    id: str
    request_id: str
    action: str
    actor_id: str | None
    created_at: str


class WaitlistRecord(WaitlistModel):
    """A queue row with email outcomes."""

    request: WaitlistRequest
    deliveries: list[WaitlistDelivery]


class WaitlistAvailability(WaitlistModel):
    """Whether invitations currently lead to an available purchase."""

    available: bool
    reason: Literal["disabled", "paused", "catalog_unavailable"] | None
    allowed_offers: list[str]


class WaitlistQueue(WaitlistModel):
    """The private queue and purchase availability."""

    records: list[WaitlistRecord]
    availability: WaitlistAvailability


class WaitlistDetail(WaitlistRecord):
    """The request's full decision and delivery history."""

    events: list[WaitlistEvent]


class WaitlistDetailInput(WaitlistModel):
    """One request to review."""

    id: str = Field(min_length=1, max_length=200)


class WaitlistInviteInput(WaitlistModel):
    """Up to fifty exact recipients for one reviewed batch."""

    ids: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        min_length=1, max_length=50
    )


class WaitlistActionInput(WaitlistDetailInput):
    """A single explicitly enumerated staff decision."""

    action: Literal["revoke", "resend", "retry"]
    delivery_id: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def retry_delivery(self) -> WaitlistActionInput:
        """A retry must identify the retained delivery."""
        if self.action == "retry" and not self.delivery_id:
            message = "Choose an invitation email to retry."
            raise ValueError(message)
        return self


class WaitlistInviteResult(WaitlistModel):
    """A recipient's independent invitation outcome."""

    id: str
    status: str
    message: str


class WaitlistInvitations(WaitlistModel):
    """Invitation outcomes, preserving partial success."""

    results: list[WaitlistInviteResult]


class WaitlistActionResult(WaitlistModel):
    """The changed permission or the email delivery."""

    request: WaitlistRequest | None = None
    delivery: WaitlistDelivery | None = None

    @model_validator(mode="after")
    def changed_record(self) -> WaitlistActionResult:
        """Never report success without exactly one retained change or delivery."""
        if (self.request is None) == (self.delivery is None):
            message = "The waitlist decision has no unique result."
            raise ValueError(message)
        return self


async def _ask_app[Answer: BaseModel](
    settings: Settings,
    operator: PlatformOperator,
    operation: str,
    data: BaseModel | None,
    answer: type[Answer],
) -> Answer:
    payload = {"operation": operation, "operatorEmail": operator.email}
    if data is not None:
        payload.update(data.model_dump(by_alias=True, exclude_none=True))
    try:
        async with outbound_http_client(timeout=WAITLIST_CALLBACK_TIMEOUT_SECONDS) as client:
            result = await client.post(
                f"{settings.auth_membership_verification_url.rstrip('/')}{CALLBACK_PATH}",
                json=payload,
                headers=app_callback_headers(settings),
            )
        if result.status_code == HTTPStatus.BAD_REQUEST:
            detail = result.json().get("error")
            if isinstance(detail, str):
                raise HTTPException(status_code=HTTPStatus.BAD_REQUEST, detail=detail)
        result.raise_for_status()
        return answer.model_validate(result.json())
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY, detail=APP_UNREACHABLE_DETAIL
        ) from exc


@router.post(
    "/api/platform/waitlist", response_model=WaitlistQueue, operation_id="listWaitlistRequests"
)
async def list_waitlist(
    response: Response,
    settings: Settings = Depends(get_settings),
    operator: PlatformOperator = Depends(require_platform_action(Action.WAITLIST_READ)),
) -> WaitlistQueue:
    """Read applicants only for a verified platform operator."""
    apply_no_store_headers(response)
    return await _ask_app(settings, operator, "list", None, WaitlistQueue)


@router.post(
    "/api/platform/waitlist/detail",
    response_model=WaitlistDetail,
    operation_id="loadWaitlistStaffDetail",
)
async def waitlist_detail(
    data: WaitlistDetailInput,
    response: Response,
    settings: Settings = Depends(get_settings),
    operator: PlatformOperator = Depends(require_platform_action(Action.WAITLIST_READ)),
) -> WaitlistDetail:
    """Review a retained request and its operator-attributed history."""
    apply_no_store_headers(response)
    return await _ask_app(settings, operator, "detail", data, WaitlistDetail)


@router.post(
    "/api/platform/waitlist/invite",
    response_model=WaitlistInvitations,
    operation_id="inviteWaitlistRequests",
)
async def invite_waitlist(
    data: WaitlistInviteInput,
    response: Response,
    settings: Settings = Depends(get_settings),
    operator: PlatformOperator = Depends(require_platform_action(Action.WAITLIST_WRITE)),
) -> WaitlistInvitations:
    """Invite the exact reviewed recipients through the existing durable mailer."""
    apply_no_store_headers(response)
    return await _ask_app(settings, operator, "invite", data, WaitlistInvitations)


@router.post(
    "/api/platform/waitlist/action",
    response_model=WaitlistActionResult,
    response_model_exclude_unset=True,
    operation_id="actOnWaitlistRequest",
)
async def act_on_waitlist(
    data: WaitlistActionInput,
    response: Response,
    settings: Settings = Depends(get_settings),
    operator: PlatformOperator = Depends(require_platform_action(Action.WAITLIST_WRITE)),
) -> WaitlistActionResult:
    """Withdraw permission, resend an invitation or retry a retained email."""
    apply_no_store_headers(response)
    return await _ask_app(settings, operator, "action", data, WaitlistActionResult)
