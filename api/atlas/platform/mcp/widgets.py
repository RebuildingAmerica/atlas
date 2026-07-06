"""MCP Apps widget extension: serves built widget bundles as MCP resources.

Registers Atlas's MCP Apps UI resources — one per entry in `WIDGET_RESOURCES`
below — as MCP resources using the MCP Apps extension's resource MIME type.
Each built widget bundle comes from `@rebuildingamerica/entity-widgets` at
`packages/entity-widgets/dist/widget/<name>.html`. `server.py` attaches
`_meta={"ui": {"resourceUri": ...}}` to the tool each widget renders for
(e.g. `get_entity` for the entity-card widget) so a compliant MCP host (one
implementing the MCP Apps extension) knows to fetch and render the matching
resource inline instead of, or alongside, the tool's raw JSON result.

Adding a new widget: build it under `packages/entity-widgets` as
`<name>.html`, add a `"<name>": "ui://atlas/<name>"` entry to
`WIDGET_RESOURCES`, and point the relevant tool's `meta=` at that URI in
`server.py`.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from atlas.platform.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Callable

    from mcp.server.fastmcp import FastMCP

__all__ = [
    "ENTITY_CARD_RESOURCE_URI",
    "MCP_APP_RESOURCE_MIME_TYPE",
    "SEARCH_RESULTS_RESOURCE_URI",
    "WIDGET_RESOURCES",
    "install_widget_extension",
    "load_widget_html",
    "resolve_widget_asset_dir",
]

MCP_APP_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"
"""The MCP Apps extension's resource MIME type.

Verified against the canonical spec source (not a documentation summary)
during an earlier throwaway spike against a real compliant test host.
"""

ENTITY_CARD_RESOURCE_URI = "ui://atlas/entity-card"
"""The compact entity-card widget's resource URI. Wired to `get_entity`."""

SEARCH_RESULTS_RESOURCE_URI = "ui://atlas/search-results"
"""The paginated search-results list widget's resource URI. Wired to `search_entities`."""

WIDGET_RESOURCES: dict[str, str] = {
    "entity-card": ENTITY_CARD_RESOURCE_URI,
    "search-results": SEARCH_RESULTS_RESOURCE_URI,
}
"""Every widget this server serves: built-bundle name -> MCP resource URI.

The connections-graph widget (wired to `get_related_entities`) is a
separate, later task; adding it means adding one more entry here.
"""

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


def _has_expected_asset(directory: Path, filename: str) -> bool:
    """Return whether `directory` exists and contains `filename`.

    Parameters
    ----------
    directory:
        Candidate directory to check.
    filename:
        The built widget HTML file this candidate must contain to count as
        "found" for the widget being resolved — e.g. `"search-results.html"`.
        A directory only counts as found for the *specific* widget being
        requested, not merely for having built *some* widget: a dev checkout
        that has only rebuilt `entity-card.html` correctly falls through
        past that tier when resolving `search-results`, rather than being
        trusted just because it contains a different widget's file.

    Returns
    -------
    bool
        True when `directory / filename` is a regular file.
    """
    return (directory / filename).is_file()


def resolve_widget_asset_dir(widget_name: str) -> Path:
    """Resolve the directory containing one built MCP widget HTML bundle.

    Tries three tiers in order, using the first one that resolves to a
    directory actually containing `<widget_name>.html`:

    1. `settings.mcp_widget_assets_dir` (`ATLAS_MCP_WIDGET_ASSETS_DIR`) — an
       explicit override, for pointing at an alternate built-widget
       directory.
    2. A directory co-located with this module (`_widget_assets/`) —
       populated by a production Docker build stage.
    3. The monorepo-relative dev path
       (`packages/entity-widgets/dist/widget/`) — populated by running
       `pnpm --filter @rebuildingamerica/entity-widgets build` locally.

    Parameters
    ----------
    widget_name:
        Widget bundle name, without its `.html` suffix (e.g. `"entity-card"`).

    Returns
    -------
    Path
        The first candidate directory that exists and contains
        `<widget_name>.html`.

    Raises
    ------
    RuntimeError
        When none of the three candidates contain the expected file. No tier
        is used as a silent fallback — a missing build artifact always fails
        loudly with an actionable message, rather than surfacing later as a
        confusing file-not-found error from `load_widget_html`.
    """
    filename = f"{widget_name}.html"

    override = get_settings().mcp_widget_assets_dir
    if override:
        override_dir = Path(override)
        if _has_expected_asset(override_dir, filename):
            return override_dir

    if _has_expected_asset(_CO_LOCATED_ASSET_DIR, filename):
        return _CO_LOCATED_ASSET_DIR

    if _has_expected_asset(_MONOREPO_DEV_ASSET_DIR, filename):
        return _MONOREPO_DEV_ASSET_DIR

    msg = (
        f"No built MCP widget assets found. Looked for {filename} in: "
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
        asset_dir = resolve_widget_asset_dir(name)
        _widget_html_cache[name] = (asset_dir / f"{name}.html").read_text(encoding="utf-8")
    return _widget_html_cache[name]


def _make_widget_resource_handler(widget_name: str) -> Callable[[], str]:
    """Build a zero-argument resource handler bound to one widget's name.

    A closure that instead took `widget_name` as its own parameter (even one
    with a default value, e.g. `def handler(name: str = widget_name)`) would
    break `@mcp.resource`: it decides "template resource" (a URI with
    `{placeholders}`) vs. "plain resource" by checking whether the handler
    has *any* parameters, not whether the URI itself has placeholders. Since
    none of `WIDGET_RESOURCES`'s URIs have placeholders, giving the handler a
    parameter would raise a URI/parameter-mismatch error at registration
    time. This factory closes over `widget_name` in its own scope instead, so
    the returned function takes no parameters at all.

    Parameters
    ----------
    widget_name:
        Widget bundle name, without its `.html` suffix (e.g. `"entity-card"`).

    Returns
    -------
    Callable[[], str]
        A zero-argument function returning that widget's built HTML.
    """

    def handler() -> str:
        return load_widget_html(widget_name)

    handler.__doc__ = f"Return the {widget_name} widget's self-contained HTML bundle."
    return handler


def install_widget_extension(mcp: FastMCP) -> None:
    """Wire Atlas's MCP Apps widgets onto a FastMCP server instance.

    Registers every entry in `WIDGET_RESOURCES` as an MCP resource, served
    with the MCP Apps extension's `text/html;profile=mcp-app` MIME type.

    Parameters
    ----------
    mcp:
        The FastMCP server instance to register the resources on.
    """
    for widget_name, resource_uri in WIDGET_RESOURCES.items():
        mcp.resource(
            resource_uri,
            name=f"{widget_name}_widget",
            mime_type=MCP_APP_RESOURCE_MIME_TYPE,
        )(_make_widget_resource_handler(widget_name))
