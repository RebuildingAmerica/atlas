"""Access for the few actions only Atlas's own operators may take."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from atlas.platform.config import Settings, get_settings

from .dependencies import require_actor
from .principals import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)

STAFF_REQUIRED_DETAIL = "This action requires Atlas staff."


def is_atlas_staff(actor: AuthenticatedActor, settings: Settings) -> bool:
    """Return whether the actor is an allowlisted operator using the Atlas app.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.
    settings : Settings
        Runtime settings carrying ``operator_allowed_emails``.

    Returns
    -------
    bool
        ``True`` in local single-user mode, or for an app-signed request whose
        email is on the operator allowlist. Customer API keys and OAuth tokens
        never qualify, because any account can mint them.
    """
    if actor.is_local:
        return True
    allowed = {email.strip().lower() for email in settings.operator_allowed_emails if email.strip()}
    return actor.auth_type == "internal" and actor.email.strip().lower() in allowed


def ensure_atlas_staff(
    actor: AuthenticatedActor,
    settings: Settings,
    *,
    detail: str,
) -> AuthenticatedActor:
    """Refuse anyone but an allowlisted operator signed in through the Atlas app.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.
    settings : Settings
        Runtime settings carrying ``operator_allowed_emails``.
    detail : str
        The refusal message shown to a caller who is not staff.

    Returns
    -------
    AuthenticatedActor
        The same actor, once confirmed as staff.

    Raises
    ------
    HTTPException
        403 when the caller is not an allowlisted operator.
    """
    if not is_atlas_staff(actor, settings):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    return actor


async def require_atlas_staff(
    actor: AuthenticatedActor = Depends(require_actor),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedActor:
    """FastAPI dependency form of :func:`ensure_atlas_staff`.

    Parameters
    ----------
    actor : AuthenticatedActor
        The authenticated caller.
    settings : Settings
        Runtime settings carrying ``operator_allowed_emails``.

    Returns
    -------
    AuthenticatedActor
        The confirmed staff actor.
    """
    return ensure_atlas_staff(actor, settings, detail=STAFF_REQUIRED_DETAIL)
