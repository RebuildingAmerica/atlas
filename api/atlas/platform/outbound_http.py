"""Preserve account callbacks and identity verification across hosting runtimes."""

from typing import Any

import httpx

from atlas.platform.hosted_runtime import current_hosted_runtime


def outbound_http_client(**kwargs: Any) -> httpx.AsyncClient:
    """Create a client with the current invocation's explicitly configured transport."""
    runtime = current_hosted_runtime()
    if runtime is not None:
        if runtime.http_transport_factory is None:
            raise RuntimeError("Hosted HTTP transport is not configured")  # noqa: TRY003
        kwargs["transport"] = runtime.http_transport_factory()
    return httpx.AsyncClient(**kwargs)
