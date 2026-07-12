"""Operator cloud-cost posture endpoints."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from atlas.domains.access.api.verification_admin import require_discount_review_actor
from atlas.domains.access.dependencies import get_usage_db
from atlas.domains.discovery.cost import DAILY_WINDOW_HOURS, daily_cost
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

router = APIRouter(tags=["access"])

__all__ = ["router"]

CloudCostPosture = Literal["pass", "warn", "block"]
CloudCostConnectionStatus = Literal["connected", "not_connected", "not_configured"]


class CloudCostGuardrail(BaseModel):
    """One operator-facing cost guardrail status."""

    id: str
    label: str
    posture: CloudCostPosture
    detail: str


class DiscoverySpendPosture(BaseModel):
    """Discovery cost-ledger spend and configured ceilings."""

    estimated_daily_usd: float = Field(description="Estimated discovery spend in the last day.")
    daily_ceiling_usd: float
    run_ceiling_usd: float
    kill_switch_enabled: bool
    posture: CloudCostPosture


class CloudBillingExportPosture(BaseModel):
    """Cloud Billing BigQuery export connection status."""

    status: CloudCostConnectionStatus
    detail: str


class ExternalFixedCostsPosture(BaseModel):
    """External provider fixed-cost accounting status."""

    status: CloudCostConnectionStatus
    detail: str


class CloudCostPostureResponse(BaseModel):
    """Operator cloud-cost posture summary."""

    generated_at: str
    posture: CloudCostPosture
    discovery_spend: DiscoverySpendPosture
    billing_export: CloudBillingExportPosture
    external_fixed_costs: ExternalFixedCostsPosture
    guardrails: list[CloudCostGuardrail]


def _daily_spend_cutoff() -> str:
    """Return the rolling daily cost-ledger cutoff."""
    return (datetime.now(UTC) - timedelta(hours=DAILY_WINDOW_HOURS)).isoformat()


def _spend_posture(*, spent: float, settings: Settings) -> CloudCostPosture:
    """Return a cost posture for current discovery spend."""
    if settings.discovery_cost_kill_switch:
        return "block"
    if spent >= settings.discovery_max_daily_cost:
        return "block"
    if spent >= settings.discovery_max_daily_cost * 0.8:
        return "warn"
    return "pass"


def _overall_posture(guardrails: list[CloudCostGuardrail]) -> CloudCostPosture:
    """Collapse guardrails into one dashboard posture."""
    if any(guardrail.posture == "block" for guardrail in guardrails):
        return "block"
    return "warn"


def _billing_export_posture() -> CloudBillingExportPosture:
    """Return the current billing export posture for v1."""
    return CloudBillingExportPosture(
        status="not_connected",
        detail="Cloud Billing BigQuery export is not connected yet.",
    )


def _external_fixed_costs_posture() -> ExternalFixedCostsPosture:
    """Return the current external fixed-cost posture for v1."""
    return ExternalFixedCostsPosture(
        status="not_configured",
        detail="External provider fixed costs are not configured yet.",
    )


def _guardrails(
    *,
    billing_export: CloudBillingExportPosture,
    discovery_spend: DiscoverySpendPosture,
    external_fixed_costs: ExternalFixedCostsPosture,
) -> list[CloudCostGuardrail]:
    """Build the operator-facing cost guardrail list."""
    billing_posture: CloudCostPosture = "warn" if billing_export.status != "connected" else "pass"
    external_posture: CloudCostPosture = (
        "warn" if external_fixed_costs.status != "connected" else "pass"
    )
    return [
        CloudCostGuardrail(
            id="discovery-cost-ledger",
            label="Discovery cost ledger",
            posture=discovery_spend.posture,
            detail="Discovery spend is checked against the rolling daily and per-run ceilings.",
        ),
        CloudCostGuardrail(
            id="artifact-registry-cleanup",
            label="Artifact Registry cleanup",
            posture="pass",
            detail="Deploy preflight applies and verifies Docker image cleanup before building.",
        ),
        CloudCostGuardrail(
            id="cloud-run-scale-to-zero",
            label="Cloud Run scale-to-zero",
            posture="pass",
            detail="Deploy preflight blocks min instances and always-allocated CPU drift.",
        ),
        CloudCostGuardrail(
            id="cloud-billing-export",
            label="Cloud Billing export",
            posture=billing_posture,
            detail=billing_export.detail,
        ),
        CloudCostGuardrail(
            id="external-fixed-costs",
            label="External fixed costs",
            posture=external_posture,
            detail=external_fixed_costs.detail,
        ),
    ]


@router.get(
    "/api/admin/cloud-costs",
    response_model=CloudCostPostureResponse,
    operation_id="getCloudCostPosture",
    summary="Get cloud cost posture",
    description="Return operator-only Atlas cloud-cost posture and guardrail status.",
)
async def get_cloud_cost_posture(
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    _review_actor: object = Depends(require_discount_review_actor),
    settings: Settings = Depends(get_settings),
) -> CloudCostPostureResponse:
    """Return operator-only Atlas cloud-cost posture and guardrail status."""
    apply_no_store_headers(response)
    spent = await daily_cost(conn, since_iso=_daily_spend_cutoff())
    discovery_spend = DiscoverySpendPosture(
        daily_ceiling_usd=settings.discovery_max_daily_cost,
        estimated_daily_usd=round(spent, 4),
        kill_switch_enabled=settings.discovery_cost_kill_switch,
        posture=_spend_posture(spent=spent, settings=settings),
        run_ceiling_usd=settings.discovery_max_run_cost,
    )
    billing_export = _billing_export_posture()
    external_fixed_costs = _external_fixed_costs_posture()
    guardrails = _guardrails(
        billing_export=billing_export,
        discovery_spend=discovery_spend,
        external_fixed_costs=external_fixed_costs,
    )
    return CloudCostPostureResponse(
        billing_export=billing_export,
        discovery_spend=discovery_spend,
        external_fixed_costs=external_fixed_costs,
        generated_at=datetime.now(UTC).isoformat(),
        guardrails=guardrails,
        posture=_overall_posture(guardrails),
    )
