"""Tell the app to email an applicant the outcome of their discount request.

The decision is made in the platform admin, which holds no user records and
sends no mail. The app owns both, so once the decision is stored the API asks
the app, over the same callback channel it uses for membership checks, to
email the person who applied.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

import httpx

from atlas.domains.access.membership import app_callback_headers

if TYPE_CHECKING:
    from atlas.domains.access.verification import DiscountSegment
    from atlas.platform.config import Settings

logger = logging.getLogger(__name__)

REVIEW_RESULT_PATH = "/api/auth/internal/discount-review-results"


async def notify_discount_review_result(
    settings: Settings,
    *,
    user_id: str,
    segment: DiscountSegment,
    status: Literal["verified", "rejected"],
) -> None:
    """Ask the app to email the applicant the review outcome.

    Parameters
    ----------
    settings : Settings
        Runtime settings carrying the app origin and callback secret.
    user_id : str
        The applicant's account.
    segment : DiscountSegment
        The discount they applied for.
    status : Literal["verified", "rejected"]
        The decision.

    Raises
    ------
    httpx.HTTPError
        When the app cannot be reached or does not confirm the email was sent.
    """
    url = f"{settings.auth_membership_verification_url.rstrip('/')}{REVIEW_RESULT_PATH}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                url,
                json={"segment": segment, "status": status, "user_id": user_id},
                headers=app_callback_headers(settings),
            )
        response.raise_for_status()
    except httpx.HTTPError:
        logger.exception(
            "The app did not confirm a discount review email",
            extra={"user_id": user_id, "segment": segment, "status": status},
        )
        raise
