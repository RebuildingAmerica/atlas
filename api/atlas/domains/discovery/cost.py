"""Cost ledger, ceilings, and kill switch for discovery spend.

Discovery is autonomous, so it must never be able to spend without a bound.
Every metered search or model call writes a durable row to ``cost_ledger``;
:func:`assert_within_budget` sums those rows and refuses to let a run continue
once it crosses a per-run ceiling, a rolling-daily ceiling, or whenever an
operator flips the kill switch. This keeps the directory affordable to run,
which keeps it online for the people who depend on it.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from atlas.platform.config import Settings
from atlas.platform.database import db

__all__ = [
    "DAILY_WINDOW_HOURS",
    "CostCeilingExceeded",
    "assert_within_budget",
    "daily_cost",
    "estimate_llm_cost",
    "estimate_search_cost",
    "record_cost",
    "run_cost",
]

CeilingScope = Literal["run", "daily", "kill_switch"]

DAILY_WINDOW_HOURS = 24
"""Width of the rolling window the daily ceiling is measured over."""

_SEARCH_COST_PER_RESULT = 0.005
"""Estimated spend (USD) attributed to each returned search result."""

_LLM_COST_PER_1K_TOKENS = 0.003
"""Estimated spend (USD) attributed to every thousand model tokens."""


class CostCeilingExceeded(Exception):  # noqa: N818
    """Raised when a discovery run may not spend any further.

    Parameters
    ----------
    scope : CeilingScope
        Which guard tripped — the per-run ceiling, the rolling-daily ceiling,
        or the operator kill switch.
    message : str
        Human-readable detail for logs (never surfaced to end users).
    """

    def __init__(self, scope: CeilingScope, message: str) -> None:
        super().__init__(message)
        self.scope: CeilingScope = scope


def estimate_search_cost(units: float) -> float:
    """Estimate the spend (USD) for a search call returning ``units`` results.

    Parameters
    ----------
    units : float
        Number of search results returned by the call.

    Returns
    -------
    float
        Estimated cost in USD.
    """
    return units * _SEARCH_COST_PER_RESULT


def estimate_llm_cost(units: float) -> float:
    """Estimate the spend (USD) for a model call consuming ``units`` tokens.

    Parameters
    ----------
    units : float
        Number of tokens consumed by the call.

    Returns
    -------
    float
        Estimated cost in USD.
    """
    return (units / 1000.0) * _LLM_COST_PER_1K_TOKENS


async def record_cost(  # noqa: PLR0913
    conn: Any,
    *,
    run_id: str,
    kind: str,
    provider: str,
    units: float,
    estimated_cost: float,
) -> None:
    """Append a metered cost to the ledger.

    Parameters
    ----------
    conn : Any
        Database connection.
    run_id : str
        The discovery run the spend belongs to.
    kind : str
        The cost category, e.g. ``"search"`` or ``"llm"``.
    provider : str
        The vendor billed, e.g. ``"brave"`` or ``"anthropic"``.
    units : float
        Billable units (search results or model tokens).
    estimated_cost : float
        Estimated spend in USD for this call.
    """
    await conn.execute(
        """
        INSERT INTO cost_ledger (
            id, run_id, kind, provider, units, estimated_cost, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (db.generate_uuid(), run_id, kind, provider, units, estimated_cost, db.now_iso()),
    )
    await conn.commit()


async def run_cost(conn: Any, run_id: str) -> float:
    """Return the total estimated spend recorded against a single run.

    Parameters
    ----------
    conn : Any
        Database connection.
    run_id : str
        The discovery run to total.

    Returns
    -------
    float
        Summed estimated cost in USD, or 0.0 when nothing is recorded yet.
    """
    cursor = await conn.execute(
        "SELECT COALESCE(SUM(estimated_cost), 0) FROM cost_ledger WHERE run_id = ?",
        (run_id,),
    )
    row = await cursor.fetchone()
    return float(row[0]) if row else 0.0


async def daily_cost(conn: Any, *, since_iso: str) -> float:
    """Return the total estimated spend across all runs since a cutoff.

    Parameters
    ----------
    conn : Any
        Database connection.
    since_iso : str
        ISO-8601 cutoff; only rows recorded at or after it are summed.

    Returns
    -------
    float
        Summed estimated cost in USD, or 0.0 when nothing qualifies.
    """
    cursor = await conn.execute(
        "SELECT COALESCE(SUM(estimated_cost), 0) FROM cost_ledger WHERE created_at >= ?",
        (since_iso,),
    )
    row = await cursor.fetchone()
    return float(row[0]) if row else 0.0


async def assert_within_budget(conn: Any, *, run_id: str, settings: Settings) -> None:
    """Raise :class:`CostCeilingExceeded` if a run may not spend further.

    Parameters
    ----------
    conn : Any
        Database connection.
    run_id : str
        The discovery run about to incur more spend.
    settings : Settings
        The resolved application settings carrying the ceilings and kill switch.

    Raises
    ------
    CostCeilingExceeded
        When the kill switch is on, the per-run ceiling is crossed, or the
        rolling-daily ceiling is crossed.
    """
    if settings.discovery_cost_kill_switch:
        raise CostCeilingExceeded("kill_switch", "discovery cost kill switch is engaged")

    spent_for_run = await run_cost(conn, run_id)
    if spent_for_run >= settings.discovery_max_run_cost:
        raise CostCeilingExceeded(
            "run",
            f"run {run_id} spent {spent_for_run} of {settings.discovery_max_run_cost} ceiling",
        )

    since = (datetime.now(UTC) - timedelta(hours=DAILY_WINDOW_HOURS)).isoformat()
    spent_today = await daily_cost(conn, since_iso=since)
    if spent_today >= settings.discovery_max_daily_cost:
        raise CostCeilingExceeded(
            "daily",
            f"daily spend {spent_today} of {settings.discovery_max_daily_cost} ceiling",
        )
