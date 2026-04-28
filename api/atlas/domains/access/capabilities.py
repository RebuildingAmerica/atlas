"""Capability resolver for Atlas access control.

Maps active product subscriptions to a resolved set of capabilities and
resource limits. Mirrors the TypeScript resolver on the web side — same
static config, same merge logic, different language.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, status

from atlas.platform.config import Settings, get_settings

from .challenges import build_bearer_challenge

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from .principals import AuthenticatedActor

# ---------------------------------------------------------------------------
# Capability sets
# ---------------------------------------------------------------------------

_PRO_CAPABILITIES: frozenset[str] = frozenset(
    {
        "research.run",
        "research.unlimited",
        "workspace.notes",
        "workspace.export",
        "api.keys",
        "api.mcp",
    }
)

_TEAM_CAPABILITIES: frozenset[str] = _PRO_CAPABILITIES | frozenset(
    {
        "workspace.shared",
        "monitoring.watchlists",
        "integrations.slack",
        "auth.sso",
    }
)

PRODUCT_CAPABILITIES: dict[str, frozenset[str]] = {
    "atlas_pro": _PRO_CAPABILITIES,
    "atlas_research_pass": _PRO_CAPABILITIES,
    "atlas_team": _TEAM_CAPABILITIES,
}

DEFAULT_CAPABILITIES: frozenset[str] = frozenset({"research.run"})

# ---------------------------------------------------------------------------
# Limit sets
# ---------------------------------------------------------------------------

_PRO_LIMITS: dict[str, int | None] = {
    "research_runs_per_month": None,
    "max_shortlists": None,
    "max_shortlist_entries": None,
    "max_api_keys": 1,
    "api_requests_per_day": 1000,
    "public_api_requests_per_hour": None,
    "max_members": 1,
}

_TEAM_LIMITS: dict[str, int | None] = {
    "research_runs_per_month": None,
    "max_shortlists": None,
    "max_shortlist_entries": None,
    "max_api_keys": None,
    "api_requests_per_day": 10000,
    "public_api_requests_per_hour": None,
    "max_members": 50,
}

PRODUCT_LIMITS: dict[str, dict[str, int | None]] = {
    "atlas_pro": _PRO_LIMITS,
    "atlas_research_pass": _PRO_LIMITS,
    "atlas_team": _TEAM_LIMITS,
}

DEFAULT_LIMITS: dict[str, int | None] = {
    "research_runs_per_month": 2,
    "max_shortlists": 1,
    "max_shortlist_entries": 25,
    "max_api_keys": 0,
    "api_requests_per_day": 0,
    "public_api_requests_per_hour": 100,
    "max_members": 1,
}


# ---------------------------------------------------------------------------
# Resolved capabilities dataclass
# ---------------------------------------------------------------------------


@dataclass
class ResolvedCapabilities:
    capabilities: frozenset[str] = field(default_factory=frozenset)
    limits: dict[str, int | None] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Merge helpers
# ---------------------------------------------------------------------------


def _merge_limits(
    base: dict[str, int | None],
    override: dict[str, int | None],
) -> dict[str, int | None]:
    """Return the most-permissive value for each limit key.

    None means unlimited, so None always wins over any integer.  When both
    values are integers, the larger one wins.
    """
    merged: dict[str, int | None] = dict(base)
    for key, override_val in override.items():
        base_val = merged.get(key)
        if base_val is None or override_val is None:
            merged[key] = None
        else:
            merged[key] = max(base_val, override_val)
    return merged


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_capabilities(active_products: list[str]) -> ResolvedCapabilities:
    """Resolve the union of capabilities and most-permissive limits for a set
    of active product subscriptions.

    If *active_products* is empty the default (free-tier) values are returned.
    """
    if not active_products:
        return ResolvedCapabilities(
            capabilities=DEFAULT_CAPABILITIES,
            limits=dict(DEFAULT_LIMITS),
        )

    caps: frozenset[str] = frozenset()
    limits: dict[str, int | None] = {}

    for product in active_products:
        product_caps = PRODUCT_CAPABILITIES.get(product, frozenset())
        caps = caps | product_caps

        product_limits = PRODUCT_LIMITS.get(product, {})
        limits = dict(product_limits) if not limits else _merge_limits(limits, product_limits)

    return ResolvedCapabilities(capabilities=caps, limits=limits)


def has_capability(resolved: ResolvedCapabilities, cap: str) -> bool:
    """Return True if *cap* is present in the resolved capability set."""
    return cap in resolved.capabilities


def get_limit(resolved: ResolvedCapabilities, limit: str) -> int | None:
    """Return the resolved value for *limit*, or None if unlimited."""
    return resolved.limits[limit]


_REQUIRED_PLAN_FOR_CAPABILITY: dict[str, str] = {
    "api.mcp": "pro",
    "api.keys": "pro",
    "research.unlimited": "pro",
    "workspace.notes": "pro",
    "workspace.export": "pro",
    "workspace.shared": "team",
    "monitoring.watchlists": "team",
    "integrations.slack": "team",
    "auth.sso": "team",
}


def _resolve_pricing_url(settings: Settings) -> str | None:
    """Return the canonical pricing-page URL for upgrade-aware 403s.

    Derived from the configured resource URL so previews and staging point
    at their own domain instead of the production hostname.  Returns
    ``None`` when auth is disabled (no audience configured) so the helper
    callers can fall back gracefully.
    """
    base = settings.auth_jwt_resource_url.rstrip("/")
    if not base:
        return None
    return f"{base}/pricing"


def require_capability(cap: str) -> Callable[..., Awaitable[None]]:
    """Return a FastAPI dependency that raises 403 if the actor lacks the capability.

    OAuth-authenticated actors get a standards-compliant ``insufficient_scope``
    challenge with ``error_uri`` pointing at the pricing page so MCP clients
    can render an upgrade CTA without parsing Atlas-specific fields.  The
    response body keeps a parallel structured representation for clients that
    don't introspect ``WWW-Authenticate``.
    """
    from .dependencies import require_org_actor

    async def dependency(
        actor: AuthenticatedActor = Depends(require_org_actor),
        settings: Settings = Depends(get_settings),
    ) -> None:
        if (
            actor.resolved_capabilities is not None
            and cap in actor.resolved_capabilities.capabilities
        ):
            return

        required_plan = _REQUIRED_PLAN_FOR_CAPABILITY.get(cap, "pro")
        pricing_url = _resolve_pricing_url(settings)
        description = (
            f"This request requires the Atlas {required_plan.title()} plan "
            f"(missing capability: {cap})."
        )

        headers: dict[str, str] | None = None
        if actor.auth_type == "oauth_jwt":
            headers = {
                "WWW-Authenticate": build_bearer_challenge(
                    settings,
                    scope=[cap],
                    error="insufficient_scope",
                    error_description=description,
                    error_uri=pricing_url,
                ),
            }

        detail: dict[str, object] = {
            "error": "plan_required",
            "message": description,
            "capability": cap,
            "plan_required": required_plan,
        }
        if pricing_url:
            detail["upgrade_url"] = pricing_url

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
            headers=headers,
        )

    return dependency


def enforce_limit(limit: str) -> Callable[..., Awaitable[int | None]]:
    """Return a FastAPI dependency that provides the actor's limit value.

    Returns None for unlimited, or the numeric cap. The endpoint is
    responsible for checking current usage against this value.
    """
    from .dependencies import require_org_actor

    async def dependency(
        actor: AuthenticatedActor = Depends(require_org_actor),
    ) -> int | None:
        if actor.resolved_capabilities is None:
            return DEFAULT_LIMITS.get(limit)
        return actor.resolved_capabilities.limits.get(limit)

    return dependency
