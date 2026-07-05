"""Org-scoped monthly discovery-run budgets.

Kept separate from ``api_org.py`` so this has no dependency on
``atlas.platform.http`` (which itself imports ``atlas.domains.discovery.api``
for its router) — importing ``OrgDiscoveryBudgetCRUD`` from ``api_org.py``
directly created a circular import whenever something imported
``atlas.platform.mcp`` before ``atlas.platform.http`` had already been fully
loaded.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import HTTPException
from pydantic import BaseModel

from atlas.platform.database import db as db_util

if TYPE_CHECKING:
    import aiosqlite

__all__ = [
    "DEFAULT_ORG_DISCOVERY_MONTHLY_LIMIT",
    "OrgDiscoveryBudgetCRUD",
    "OrgDiscoveryBudgetExceededResponse",
    "OrgDiscoveryBudgetModel",
]

DEFAULT_ORG_DISCOVERY_MONTHLY_LIMIT = 3
"""Default monthly private discovery runs per workspace."""


class OrgDiscoveryBudgetExceededResponse(BaseModel):
    """Response detail returned when a tenant monthly discovery budget is spent."""

    org_id: str
    month: str
    monthly_run_limit: int
    used_runs: int
    remaining_runs: int


@dataclass
class OrgDiscoveryBudgetModel:
    """Monthly discovery-run budget for a workspace."""

    org_id: str
    month: str
    monthly_run_limit: int
    used_runs: int
    updated_at: str

    @property
    def remaining_runs(self) -> int:
        """Return how many private discovery runs remain in this budget window."""
        return max(self.monthly_run_limit - self.used_runs, 0)


class OrgDiscoveryBudgetCRUD:
    """CRUD for tenant-scoped monthly discovery run budgets."""

    @staticmethod
    async def get_budget(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        month: str,
    ) -> OrgDiscoveryBudgetModel | None:
        """Return an org discovery budget row, if one exists."""
        cursor = await conn.execute(
            """
            SELECT org_id, month, monthly_run_limit, used_runs, updated_at
            FROM org_discovery_budgets
            WHERE org_id = ? AND month = ?
            """,
            (org_id, month),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return OrgDiscoveryBudgetModel(
            org_id=row[0],
            month=row[1],
            monthly_run_limit=row[2],
            used_runs=row[3],
            updated_at=row[4],
        )

    @staticmethod
    async def set_budget(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        month: str,
        monthly_run_limit: int,
        used_runs: int = 0,
    ) -> OrgDiscoveryBudgetModel:
        """Create or replace an org discovery budget row."""
        updated_at = db_util.now_iso()
        await conn.execute(
            """
            INSERT INTO org_discovery_budgets (
                org_id, month, monthly_run_limit, used_runs, updated_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(org_id, month) DO UPDATE SET
                monthly_run_limit = excluded.monthly_run_limit,
                used_runs = excluded.used_runs,
                updated_at = excluded.updated_at
            """,
            (org_id, month, monthly_run_limit, used_runs, updated_at),
        )
        await conn.commit()
        budget = await OrgDiscoveryBudgetCRUD.get_budget(conn, org_id=org_id, month=month)
        assert budget is not None, "budget was just upserted"
        return budget

    @staticmethod
    async def reserve_run(
        conn: aiosqlite.Connection,
        *,
        org_id: str,
        month: str,
        default_monthly_limit: int = DEFAULT_ORG_DISCOVERY_MONTHLY_LIMIT,
    ) -> OrgDiscoveryBudgetModel:
        """Reserve one discovery run or raise HTTP 409 with the current budget state."""
        budget = await OrgDiscoveryBudgetCRUD.get_budget(conn, org_id=org_id, month=month)
        if budget is None:
            budget = await OrgDiscoveryBudgetCRUD.set_budget(
                conn,
                org_id=org_id,
                month=month,
                monthly_run_limit=default_monthly_limit,
                used_runs=0,
            )

        if budget.used_runs >= budget.monthly_run_limit:
            detail = OrgDiscoveryBudgetExceededResponse(
                org_id=budget.org_id,
                month=budget.month,
                monthly_run_limit=budget.monthly_run_limit,
                used_runs=budget.used_runs,
                remaining_runs=budget.remaining_runs,
            )
            raise HTTPException(status_code=409, detail=detail.model_dump())

        await conn.execute(
            """
            UPDATE org_discovery_budgets
            SET used_runs = used_runs + 1, updated_at = ?
            WHERE org_id = ? AND month = ?
            """,
            (db_util.now_iso(), org_id, month),
        )
        await conn.commit()
        reserved = await OrgDiscoveryBudgetCRUD.get_budget(conn, org_id=org_id, month=month)
        assert reserved is not None, "budget existed before reservation"
        return reserved
