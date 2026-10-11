"""Acceptance-only API entrypoint using real Access verification with ephemeral test JWKS.

Deployed API entrypoints never import this module. The local browser authority
issues real RS256 assertions; both admin and API verify them independently.
"""

from __future__ import annotations

import json
import os
from typing import Any

import uvicorn

from atlas.domains.access.cloudflare_access import AccessConfig, CloudflareAccessVerifier
from atlas.main import create_app
from atlas.platform.authz import platform_guard


async def _certs(_url: str) -> dict[str, Any]:
    return json.loads(os.environ["ATLAS_E2E_ACCESS_JWKS"])  # type: ignore[no-any-return]


_verifiers: dict[AccessConfig, CloudflareAccessVerifier] = {}


def _verifier_for(config: AccessConfig) -> CloudflareAccessVerifier:
    return _verifiers.setdefault(config, CloudflareAccessVerifier(config, fetch_certs=_certs))


if __name__ == "__main__":
    platform_guard.access_verifier_for = _verifier_for
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ["PORT"]))
