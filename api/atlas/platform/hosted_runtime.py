"""Request-owned hosting interfaces for existing Atlas API behavior."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from collections.abc import Iterator

    from atlas.platform.config import Settings


class DatabaseConnector(Protocol):
    """Open a connection owned by the current hosted request."""

    async def __call__(self, database_url: str, *, backend: str | None = None) -> Any: ...


@dataclass(frozen=True)
class HostedRuntime:
    """Provider configuration and connector; never shared visitor identity."""

    settings: Settings
    connect: DatabaseConnector


_runtime: ContextVar[HostedRuntime | None] = ContextVar("atlas_hosted_runtime", default=None)


def current_hosted_runtime() -> HostedRuntime | None:
    """Return the services bound to this asynchronous request, if any."""
    return _runtime.get()


@contextmanager
def bind_hosted_runtime(runtime: HostedRuntime) -> Iterator[None]:
    """Keep concurrent callers' settings and database ownership separate.

    Parameters
    ----------
    runtime
        Explicit services supplied by the hosting adapter.

    Yields
    ------
    None
        The request scope, restored even after cancellation or failure.
    """
    token = _runtime.set(runtime)
    try:
        yield
    finally:
        _runtime.reset(token)
