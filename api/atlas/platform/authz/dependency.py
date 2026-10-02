"""FastAPI dependency that guards a route with one authorization action."""

from __future__ import annotations

from fastapi import Depends, HTTPException

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.principals import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)
from atlas.platform.config import Settings, get_settings

from .actions import Action  # noqa: TC001 - kept as a runtime attribute for route inventories
from .policy import authorize


class ActionGuard:
    """Refuse the request unless the caller may perform ``authz_action``.

    The action is a public attribute so tests can list which action each route
    declares and fail when a route declares none.
    """

    def __init__(self, action: Action) -> None:
        self.authz_action = action

    async def __call__(
        self,
        actor: AuthenticatedActor = Depends(require_actor),
        settings: Settings = Depends(get_settings),
    ) -> AuthenticatedActor:
        """Return the actor when allowed, otherwise raise the refusal.

        Parameters
        ----------
        actor : AuthenticatedActor
            The authenticated caller.
        settings : Settings
            Runtime settings carrying the deployment profile and operator allowlist.

        Returns
        -------
        AuthenticatedActor
            The same actor, once confirmed for the action.

        Raises
        ------
        HTTPException
            With the decision's status and message when the caller may not proceed.
        """
        decision = authorize(actor, self.authz_action, settings)
        if not decision.allowed:
            raise HTTPException(status_code=decision.status_code, detail=decision.detail)
        return actor


def require_action(action: Action) -> ActionGuard:
    """Create the dependency that guards a route with one action.

    Parameters
    ----------
    action : Action
        The operation the route performs.

    Returns
    -------
    ActionGuard
        A FastAPI dependency yielding the authorized actor.
    """
    return ActionGuard(action)
