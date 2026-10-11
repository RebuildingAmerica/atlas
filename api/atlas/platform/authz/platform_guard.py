"""Admit a platform route only for the admin app acting for a signed-in platform operator.

Platform routes exist only on a managed deployment and are called only by the
platform admin app, which sits behind Cloudflare Access. Two proofs must agree
before one runs:

1. The admin app's own token, an Ed25519 JWT from an issuer listed in
   ``ATLAS_MACHINE_TRUSTED_ISSUERS`` and granted this action, whose ``act``
   claim names the person it acts for.
2. That person's Cloudflare Access sign-in, forwarded unchanged in
   ``Cf-Access-Jwt-Assertion`` and verified here against the team's keys.

The two emails must match, and the email must be on
``ATLAS_PLATFORM_OPERATOR_EMAILS``. A stolen admin key alone cannot act
without a live Access sign-in, and an Access sign-in alone cannot reach the
API without the admin key.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status

from atlas.domains.access.cloudflare_access import (
    ACCESS_ASSERTION_HEADER,
    access_verifier_for,
    parse_access_config,
)
from atlas.domains.access.machine import MachinePrincipal, verify_machine_token
from atlas.platform.config import Settings, get_settings

from .dependency import AuditIdentity, bearer_token, record_decision, trusted_issuers
from .policy import NOT_FOUND_DETAIL, Decision, authorize_machine

if TYPE_CHECKING:
    from .actions import Action

logger = logging.getLogger(__name__)

ADMIN_CREDENTIAL_DETAIL = "The platform admin app's credential is required."
NOT_CONFIGURED_DETAIL = "The platform admin is not configured on this deployment."
MISSING_SIGN_IN_DETAIL = "The operator's Cloudflare Access sign-in is missing."
INVALID_SIGN_IN_DETAIL = "The operator's Cloudflare Access sign-in is not valid."
MISMATCHED_OPERATOR_DETAIL = "The admin app is acting for someone other than who signed in."
NOT_AN_OPERATOR_DETAIL = "This person is not a platform operator."


@dataclass(frozen=True, slots=True)
class PlatformOperator:
    """The person a platform request acts for, and the admin app acting for them."""

    email: str
    app: MachinePrincipal


def _refused(status_code: int, detail: str) -> Decision:
    return Decision(allowed=False, status_code=status_code, detail=detail)


async def _check_operator(request: Request, email: str, settings: Settings) -> Decision:
    """Verify the forwarded Access sign-in names ``email`` and that email may operate."""
    try:
        config = parse_access_config(settings.access_team_domain, settings.access_aud)
    except ValueError:
        logger.exception("Cloudflare Access settings are malformed")
        config = None
    if config is None:
        return _refused(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_CONFIGURED_DETAIL)
    assertion = request.headers.get(ACCESS_ASSERTION_HEADER)
    if not assertion:
        return _refused(status.HTTP_403_FORBIDDEN, MISSING_SIGN_IN_DETAIL)
    result = await access_verifier_for(config).verify(assertion)
    if result.identity is None:
        logger.warning("Refused a Cloudflare Access sign-in", extra={"reason": result.reason})
        return _refused(status.HTTP_403_FORBIDDEN, INVALID_SIGN_IN_DETAIL)
    if result.identity.email != email:
        return _refused(status.HTTP_403_FORBIDDEN, MISMATCHED_OPERATOR_DETAIL)
    operators = {item.strip().lower() for item in settings.platform_operator_emails if item.strip()}
    if email not in operators:
        return _refused(status.HTTP_403_FORBIDDEN, NOT_AN_OPERATOR_DETAIL)
    return Decision(allowed=True)


class PlatformActionGuard:
    """Refuse the request unless the admin app acts for a platform operator.

    Decisions on requests that change data, allowed or refused, are appended to
    the audit log under the operator's email before the route runs.
    """

    def __init__(self, action: Action) -> None:
        if not action.is_platform:
            msg = f"{action.value} is not a platform action."
            raise ValueError(msg)
        self.authz_action = action

    async def __call__(
        self,
        request: Request,
        settings: Settings = Depends(get_settings),
    ) -> PlatformOperator:
        """Return the operator when both proofs agree, otherwise raise the refusal.

        Parameters
        ----------
        request : Request
            The incoming request carrying the admin token and Access assertion.
        settings : Settings
            Runtime settings carrying the profile, issuers and operator list.

        Returns
        -------
        PlatformOperator
            The verified operator.

        Raises
        ------
        HTTPException
            404 outside a managed deployment; 401 without the admin app's
            credential; 403 when the credential, sign-in or operator list
            refuses; 503 when the gate is not configured or a change cannot be
            recorded.
        """
        if not settings.managed:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL)
        token = bearer_token(request)
        principal = (
            verify_machine_token(token, trusted_issuers(settings.machine_trusted_issuers))
            if token
            else None
        )
        if principal is None or principal.kind != "ed25519_jwt" or not principal.acting_for:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail=ADMIN_CREDENTIAL_DETAIL
            )
        email = principal.acting_for
        decision = authorize_machine(principal, self.authz_action, settings)
        if decision.allowed:
            decision = await _check_operator(request, email, settings)
        identity = AuditIdentity(
            plane="staff",
            actor_id=email,
            actor_email=email,
            auth_type=f"platform_admin:{principal.issuer_name}",
        )
        await record_decision(request, identity, self.authz_action, decision, settings)
        if not decision.allowed:
            raise HTTPException(status_code=decision.status_code, detail=decision.detail)
        return PlatformOperator(email=email, app=principal)


def require_platform_action(action: Action) -> PlatformActionGuard:
    """Create the dependency that admits the admin app acting for a platform operator.

    Parameters
    ----------
    action : Action
        The platform operation the route performs.

    Returns
    -------
    PlatformActionGuard
        A FastAPI dependency yielding the verified operator.
    """
    return PlatformActionGuard(action)
