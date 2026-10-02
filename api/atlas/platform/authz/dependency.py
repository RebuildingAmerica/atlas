"""FastAPI dependency that guards a route with one authorization action."""

from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, Request, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.principals import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.observability import current_request_id

from .actions import Action  # noqa: TC001 - kept as a runtime attribute for route inventories
from .audit import AuditLogCRUD, AuditRecord, actor_plane
from .policy import Decision, authorize

logger = logging.getLogger(__name__)

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
UNRECORDED_CHANGE_DETAIL = "This change could not be recorded, so it was not made."


def route_template(request: Request) -> str:
    """Return the full route template the request matched, such as ``/api/x/{id}``.

    An included router's route only knows its own path, without the prefixes of
    the routers that include it, so the prefix is taken from the request path:
    every segment before the ones the route's own template covers.

    Parameters
    ----------
    request : Request
        The incoming request.

    Returns
    -------
    str
        The matched template, or the request path when no route is attached.
    """
    path = request.url.path
    template = getattr(request.scope.get("route"), "path_format", None)
    if not isinstance(template, str) or not template:
        return path
    prefix_length = len(path.split("/")) - len(template.split("/"))
    if prefix_length < 0:
        return path
    return "/".join(path.split("/")[: prefix_length + 1]) + template


async def _record_decision(
    request: Request,
    actor: AuthenticatedActor,
    action: Action,
    decision: Decision,
    settings: Settings,
) -> None:
    """Append the decision to the audit log, refusing the change if that fails."""
    route = route_template(request)
    record = AuditRecord(
        plane=actor_plane(actor),
        actor_id=actor.user_id,
        actor_email=actor.email or None,
        auth_type=actor.auth_type,
        action=action,
        allowed=decision.allowed,
        status_code=decision.status_code,
        method=request.method,
        route=route,
        target={str(key): str(value) for key, value in request.path_params.items()},
        reason=decision.detail or None,
        request_id=current_request_id() or None,
    )
    try:
        conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
        try:
            await AuditLogCRUD.record(conn, record)
        finally:
            await conn.close()
    except Exception as exc:
        logger.exception("Could not record an operator decision", extra={"action": action.value})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=UNRECORDED_CHANGE_DETAIL,
        ) from exc


class ActionGuard:
    """Refuse the request unless the caller may perform ``authz_action``.

    Decisions on requests that change data, allowed or refused, are appended to
    the audit log before the route runs. The action is a public attribute so
    tests can list which action each route declares and fail when a route
    declares none.
    """

    def __init__(self, action: Action) -> None:
        self.authz_action = action

    async def __call__(
        self,
        request: Request,
        actor: AuthenticatedActor = Depends(require_actor),
        settings: Settings = Depends(get_settings),
    ) -> AuthenticatedActor:
        """Return the actor when allowed, otherwise raise the refusal.

        Parameters
        ----------
        request : Request
            The incoming request, used for the audit record.
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
            With the decision's status and message when the caller may not
            proceed, or 503 when a change cannot be recorded.
        """
        decision = authorize(actor, self.authz_action, settings)
        if (
            request.method not in _SAFE_METHODS
            and decision.status_code != status.HTTP_404_NOT_FOUND
        ):
            await _record_decision(request, actor, self.authz_action, decision, settings)
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
