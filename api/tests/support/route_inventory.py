"""List every route of the app with the authorization action it declares.

FastAPI wraps included routers in a private type, so walking them needs its
``effective_route_contexts``. This is the one place that depends on that shape;
a FastAPI upgrade that changes it fails here, loudly, rather than letting the
inventory silently see no routes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi.routing import APIRoute

from atlas.platform.authz import Action, ActionGuard

if TYPE_CHECKING:
    from collections.abc import Iterator

    from fastapi import FastAPI

_IGNORED_METHODS = frozenset({"HEAD", "OPTIONS"})


@dataclass(frozen=True, slots=True)
class RouteDeclaration:
    """One HTTP operation and the authorization actions its dependencies declare."""

    method: str
    path: str
    actions: frozenset[Action]


def _declared_actions(dependant: Any) -> frozenset[Action]:
    """Collect the actions declared by ``ActionGuard`` dependencies at any depth."""
    actions: set[Action] = set()
    for dependency in dependant.dependencies:
        if isinstance(dependency.call, ActionGuard):
            actions.add(dependency.call.authz_action)
        actions |= _declared_actions(dependency)
    return frozenset(actions)


def _route_like_objects(app: FastAPI) -> Iterator[Any]:
    """Yield every route or effective route context registered on the app."""
    for route in app.routes:
        if type(route).__name__ == "_IncludedRouter":
            yield from route.effective_route_contexts()
        elif isinstance(route, APIRoute):
            yield route


def route_declarations(app: FastAPI) -> list[RouteDeclaration]:
    """Return one declaration per HTTP operation the app serves.

    Parameters
    ----------
    app : FastAPI
        The application whose routes are inventoried.

    Returns
    -------
    list[RouteDeclaration]
        Sorted by path then method, so failures read the same on every run.
    """
    declarations = [
        RouteDeclaration(method=method, path=item.path, actions=_declared_actions(item.dependant))
        for item in _route_like_objects(app)
        if item.dependant is not None
        for method in sorted((getattr(item, "methods", None) or set()) - _IGNORED_METHODS)
    ]
    return sorted(declarations, key=lambda declaration: (declaration.path, declaration.method))
