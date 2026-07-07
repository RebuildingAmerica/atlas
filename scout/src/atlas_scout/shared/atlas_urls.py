"""Atlas URL defaults."""

from __future__ import annotations

DEFAULT_ATLAS_URL = "https://atlas.rebuildingus.org"

type HttpxVerify = bool | str


def verify_for_atlas_url(_atlas_url: str) -> HttpxVerify:
    """Return the TLS verification setting Scout should use for an Atlas URL."""
    return True
