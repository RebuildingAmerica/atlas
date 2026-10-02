"""FastAPI dependency that guards a route with one authorization action."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import cache

from fastapi import Depends, HTTPException, Request, status

from atlas.domains.access.dependencies import require_actor
from atlas.domains.access.machine import (
    MachineIssuer,
    MachinePrincipal,
    parse_machine_issuers,
    verify_machine_token,
)
from atlas.domains.access.principals import (
    AuthenticatedActor,  # noqa: TC001 - FastAPI resolves this annotation at runtime
)
from atlas.platform.config import Settings, get_settings
from atlas.platform.database import get_db_connection
from atlas.platform.observability import current_request_id

from .actions import Action
from .audit import AuditLogCRUD, AuditRecord, Plane, actor_plane
from .policy import Decision, authorize, authorize_machine

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


@dataclass(frozen=True, slots=True)
class AuditIdentity:
    """Who an audit record names: the plane, the actor and how they signed in."""

    plane: Plane
    actor_id: str
    actor_email: str | None
    auth_type: str


def _person_identity(actor: AuthenticatedActor) -> AuditIdentity:
    return AuditIdentity(
        plane=actor_plane(actor),
        actor_id=actor.user_id,
        actor_email=actor.email or None,
        auth_type=actor.auth_type,
    )


def _machine_identity(principal: MachinePrincipal) -> AuditIdentity:
    return AuditIdentity(
        plane="machine",
        actor_id=f"{principal.issuer_name}:{principal.subject}",
        actor_email=principal.acting_for,
        auth_type=f"machine:{principal.kind}",
    )


async def record_decision(
    request: Request,
    identity: AuditIdentity,
    action: Action,
    decision: Decision,
    settings: Settings,
) -> None:
    """Append the decision to the audit log, refusing the change if that fails.

    Parameters
    ----------
    request : Request
        The incoming request; safe methods are not recorded.
    identity : AuditIdentity
        Who made the decision.
    action : Action
        The operation attempted.
    decision : Decision
        The outcome; a 404 is not recorded, because the surface does not exist.
    settings : Settings
        Runtime settings carrying the database location.

    Raises
    ------
    HTTPException
        503 when the record cannot be written, so the change is not made.
    """
    if request.method in _SAFE_METHODS or decision.status_code == status.HTTP_404_NOT_FOUND:
        return
    route = route_template(request)
    record = AuditRecord(
        plane=identity.plane,
        actor_id=identity.actor_id,
        actor_email=identity.actor_email,
        auth_type=identity.auth_type,
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
        await record_decision(
            request, _person_identity(actor), self.authz_action, decision, settings
        )
        if not decision.allowed:
            raise HTTPException(status_code=decision.status_code, detail=decision.detail)
        return actor


LOCAL_MACHINE = MachinePrincipal(
    issuer_name="local",
    kind="local",
    subject="local",
    actions=frozenset(action.value for action in Action if action.is_machine),
    acting_for=None,
)
"""Single-user mode runs its own scheduled work; there is no one else to trust."""

UNTRUSTED_MACHINE_DETAIL = "A trusted machine credential is required."


@cache
def trusted_issuers(raw: str) -> list[MachineIssuer]:
    """Return the parsed ``ATLAS_MACHINE_TRUSTED_ISSUERS``, parsed once per value.

    Parameters
    ----------
    raw : str
        The setting's JSON text.

    Returns
    -------
    list[MachineIssuer]
        The declared issuers.
    """
    return parse_machine_issuers(raw)


def bearer_token(request: Request) -> str | None:
    """Return the request's bearer credential, if it sends one.

    Parameters
    ----------
    request : Request
        The incoming request.

    Returns
    -------
    str | None
        The credential after ``Bearer``, or ``None``.
    """
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    return token.strip() or None if scheme.lower() == "bearer" else None


class MachineActionGuard:
    """Refuse the request unless a trusted machine credential grants ``authz_action``.

    People never pass this guard, whatever they hold: a route that only a
    scheduler or an internal app should call takes a machine credential from
    ``ATLAS_MACHINE_TRUSTED_ISSUERS`` and nothing else.
    """

    def __init__(self, action: Action) -> None:
        self.authz_action = action

    async def __call__(
        self,
        request: Request,
        settings: Settings = Depends(get_settings),
    ) -> MachinePrincipal:
        """Return the verified machine when it may perform the action.

        Parameters
        ----------
        request : Request
            The incoming request carrying ``Authorization: Bearer <credential>``.
        settings : Settings
            Runtime settings carrying the trusted issuers.

        Returns
        -------
        MachinePrincipal
            The verified machine.

        Raises
        ------
        HTTPException
            401 without a trusted credential, 403 when the credential is not
            trusted for this action, 404 for a platform action outside a
            managed deployment, or 503 when a change cannot be recorded.
        """
        if not settings.multi_user:
            return LOCAL_MACHINE
        token = bearer_token(request)
        principal = (
            verify_machine_token(token, trusted_issuers(settings.machine_trusted_issuers))
            if token
            else None
        )
        if principal is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=UNTRUSTED_MACHINE_DETAIL,
            )
        decision = authorize_machine(principal, self.authz_action, settings)
        await record_decision(
            request, _machine_identity(principal), self.authz_action, decision, settings
        )
        if not decision.allowed:
            raise HTTPException(status_code=decision.status_code, detail=decision.detail)
        return principal


def require_machine_action(action: Action) -> MachineActionGuard:
    """Create the dependency that admits only a machine trusted for one action.

    Parameters
    ----------
    action : Action
        The machine or platform operation the route performs.

    Returns
    -------
    MachineActionGuard
        A FastAPI dependency yielding the verified machine.
    """
    return MachineActionGuard(action)


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
