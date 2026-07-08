"""Profile URL helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas.domains.catalog.models.entry import EntryModel

_PROFILE_ROUTE_SEGMENT_BY_TYPE = {
    "person": "people",
    "organization": "organizations",
}


def _profile_url(entry: EntryModel, public_url: str | None) -> str | None:
    """Build the absolute public profile URL for an entity, when derivable."""
    if not public_url or not entry.slug:
        return None
    segment = _PROFILE_ROUTE_SEGMENT_BY_TYPE.get(entry.type, f"{entry.type}s")
    return f"{public_url.rstrip('/')}/profiles/{segment}/{entry.slug}"
