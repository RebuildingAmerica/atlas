"""Decide whether an authenticated caller may perform an action."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import status

if TYPE_CHECKING:
    from atlas.domains.access.principals import AuthenticatedActor
    from atlas.platform.config import Settings

    from .actions import Action

NOT_FOUND_DETAIL = "Not found."


@dataclass(frozen=True, slots=True)
class Decision:
    """The outcome of one authorization check."""

    allowed: bool
    status_code: int = status.HTTP_200_OK
    detail: str = ""


def _is_instance_operator(actor: AuthenticatedActor, settings: Settings) -> bool:
    """Return whether the caller operates this instance through the Atlas app.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.
    settings : Settings
        Runtime settings carrying ``operator_allowed_emails``.

    Returns
    -------
    bool
        ``True`` in local single-user mode, or for an app-signed request from a
        passkey-ready session whose email is on the operator allowlist. Customer
        API keys and OAuth tokens never qualify, because any account can mint
        them, and a magic-link-only session never qualifies, because it proves
        control of a mailbox rather than of the operator's passkey.
    """
    if actor.is_local:
        return True
    allowed = {email.strip().lower() for email in settings.operator_allowed_emails if email.strip()}
    return (
        actor.auth_type == "internal"
        and actor.account_ready
        and actor.email.strip().lower() in allowed
    )


def authorize(actor: AuthenticatedActor, action: Action, settings: Settings) -> Decision:
    """Decide whether the actor may perform the action; refuse unless a rule allows it.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.
    action : Action
        The operation being attempted.
    settings : Settings
        Runtime settings carrying the deployment profile and operator allowlist.

    Returns
    -------
    Decision
        Allowed, or refused with the status and message the caller should see.
        Platform actions report 404 when the deployment is not managed, because
        that surface does not exist there. Local single-user mode never holds a
        platform action.
    """
    refusal = Decision(
        allowed=False,
        status_code=status.HTTP_403_FORBIDDEN,
        detail=action.refusal_detail,
    )
    if action.is_platform:
        if not settings.managed:
            return Decision(
                allowed=False,
                status_code=status.HTTP_404_NOT_FOUND,
                detail=NOT_FOUND_DETAIL,
            )
        if actor.is_local:
            return refusal
    if _is_instance_operator(actor, settings):
        return Decision(allowed=True)
    return refusal


def is_granted(actor: AuthenticatedActor, action: Action, settings: Settings) -> bool:
    """Return whether the actor may perform the action.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.
    action : Action
        The operation being attempted.
    settings : Settings
        Runtime settings carrying the deployment profile and operator allowlist.

    Returns
    -------
    bool
        ``True`` when :func:`authorize` allows the action.
    """
    return authorize(actor, action, settings).allowed
