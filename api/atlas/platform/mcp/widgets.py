"""MCP Apps widget extension: serves built widget bundles as MCP resources.

Registers `ui://atlas/entity-card` — the compact entity-card widget built by
`@rebuildingamerica/entity-widgets` at
`packages/entity-widgets/dist/widget/entity-card.html` — as an MCP resource
using the MCP Apps extension's resource MIME type. `server.py` attaches
`_meta={"ui": {"resourceUri": WIDGET_RESOURCE_URI}}` to the `get_entity` tool
so a compliant MCP host (one implementing the MCP Apps extension) knows to
fetch and render this resource inline instead of, or alongside, the tool's
raw JSON result.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from atlas.platform.config import get_settings

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

__all__ = [
    "MCP_APP_RESOURCE_MIME_TYPE",
    "WIDGET_RESOURCE_URI",
    "install_widget_extension",
    "load_widget_html",
    "resolve_widget_asset_dir",
]

MCP_APP_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"
"""The MCP Apps extension's resource MIME type.

Verified against the canonical spec source (not a documentation summary)
during an earlier throwaway spike against a real compliant test host.
"""

WIDGET_RESOURCE_URI = "ui://atlas/entity-card"
"""The one widget this phase wires up.

Search-result and connections-graph widgets are separate, later tasks.
"""

_WIDGET_ASSET_FILENAME = "entity-card.html"
"""Sentinel filename used to decide whether a candidate directory actually
holds built widget assets, rather than just happening to exist."""

_CO_LOCATED_ASSET_DIR = Path(__file__).parent / "_widget_assets"
"""Populated by a production Docker build stage (a later task), not by us."""

_MONOREPO_DEV_ASSET_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "entity-widgets" / "dist" / "widget"
)
"""Populated by running `pnpm --filter @rebuildingamerica/entity-widgets build`
in a developer's monorepo checkout. `parents[4]` walks up from this file
(`api/atlas/platform/mcp/widgets.py`) through `mcp`, `platform`, `atlas`, and
`api` to the repo root that also contains `packages/`."""

_widget_html_cache: dict[str, str] = {}
"""Process-global cache keyed by widget name.

Atlas's MCP server runs `stateless_http=True` behind Cloud Run, so re-reading
the same file from disk on every `resources/read` call across many concurrent
requests would be wasteful; each widget's HTML is read from disk at most once
per process.
"""


def _has_expected_asset(directory: Path) -> bool:
    """Return whether `directory` exists and contains the built widget HTML.

    Parameters
    ----------
    directory:
        Candidate directory to check.

    Returns
    -------
    bool
        True when `directory / _WIDGET_ASSET_FILENAME` is a regular file.
    """
    return (directory / _WIDGET_ASSET_FILENAME).is_file()


def resolve_widget_asset_dir() -> Path:
    """Resolve the directory containing built MCP widget HTML bundles.

    Tries three tiers in order, using the first one that resolves to a
    directory actually containing the expected built widget file:

    1. `settings.mcp_widget_assets_dir` (`ATLAS_MCP_WIDGET_ASSETS_DIR`) — an
       explicit override, for pointing at an alternate built-widget
       directory.
    2. A directory co-located with this module (`_widget_assets/`) —
       populated by a production Docker build stage (a later task).
    3. The monorepo-relative dev path
       (`packages/entity-widgets/dist/widget/`) — populated by running
       `pnpm --filter @rebuildingamerica/entity-widgets build` locally.

    Returns
    -------
    Path
        The first candidate directory that exists and contains the expected
        built widget HTML file.

    Raises
    ------
    RuntimeError
        When none of the three candidates contain the expected file. No tier
        is used as a silent fallback — a missing build artifact always fails
        loudly with an actionable message, rather than surfacing later as a
        confusing file-not-found error from `load_widget_html`.
    """
    override = get_settings().mcp_widget_assets_dir
    if override:
        override_dir = Path(override)
        if _has_expected_asset(override_dir):
            return override_dir

    if _has_expected_asset(_CO_LOCATED_ASSET_DIR):
        return _CO_LOCATED_ASSET_DIR

    if _has_expected_asset(_MONOREPO_DEV_ASSET_DIR):
        return _MONOREPO_DEV_ASSET_DIR

    msg = (
        f"No built MCP widget assets found. Looked for {_WIDGET_ASSET_FILENAME} in: "
        f"the ATLAS_MCP_WIDGET_ASSETS_DIR override ({override or 'not set'}), "
        f"{_CO_LOCATED_ASSET_DIR}, and {_MONOREPO_DEV_ASSET_DIR}. Run "
        "`pnpm --filter @rebuildingamerica/entity-widgets build` from the repo root "
        "to populate the monorepo dev path, or set ATLAS_MCP_WIDGET_ASSETS_DIR to a "
        "directory that already contains it."
    )
    raise RuntimeError(msg)


def load_widget_html(name: str) -> str:
    """Return a built widget's HTML, caching it for the life of the process.

    Parameters
    ----------
    name:
        Widget bundle name, without its `.html` suffix (e.g. `"entity-card"`).

    Returns
    -------
    str
        The widget's self-contained HTML document.
    """
    if name not in _widget_html_cache:
        asset_dir = resolve_widget_asset_dir()
        _widget_html_cache[name] = (asset_dir / f"{name}.html").read_text(encoding="utf-8")
    return _widget_html_cache[name]


def install_widget_extension(mcp: FastMCP) -> None:
    """Wire Atlas's MCP Apps widgets onto a FastMCP server instance.

    Registers the entity-card widget as the `ui://atlas/entity-card`
    resource, served with the MCP Apps extension's
    `text/html;profile=mcp-app` MIME type.

    Parameters
    ----------
    mcp:
        The FastMCP server instance to register the resource on.
    """

    @mcp.resource(WIDGET_RESOURCE_URI, mime_type=MCP_APP_RESOURCE_MIME_TYPE)
    def entity_card_widget() -> str:
        """Return the entity-card widget's self-contained HTML bundle."""
        return load_widget_html("entity-card")
