"""Atlas URL construction for run sync output."""

from __future__ import annotations


def _atlas_url_for_path(atlas_url: str, path: str) -> str:
    """Join an Atlas base URL and relative app path."""
    if path.startswith(("http://", "https://")):
        return path
    return f"{atlas_url.rstrip('/')}/{path.lstrip('/')}"
