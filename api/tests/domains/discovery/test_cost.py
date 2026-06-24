"""Tests for the discovery cost ledger, ceilings, and kill switch."""

import pytest

from atlas.domains.discovery.cost import (
    CostCeilingExceeded,
    assert_within_budget,
    daily_cost,
    estimate_llm_cost,
    estimate_search_cost,
    record_cost,
    run_cost,
)
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models.database import get_db_connection
from atlas.platform.config import Settings


async def _make_run(conn: object) -> str:
    """Create a discovery run to anchor cost-ledger rows against."""
    return await DiscoveryRunCRUD.create(
        conn, location_query="Kansas City, MO", state="MO", issue_areas=["housing_affordability"]
    )


async def test_cost_ledger_table_exists(db_url: str) -> None:
    """init_db must create the cost_ledger table with the expected columns."""
    conn = await get_db_connection(db_url)
    try:
        cursor = await conn.execute("PRAGMA table_info(cost_ledger)")
        rows = await cursor.fetchall()
    finally:
        await conn.close()

    columns = {row[1] for row in rows}
    assert columns >= {
        "id",
        "run_id",
        "kind",
        "provider",
        "units",
        "estimated_cost",
        "created_at",
    }


def test_estimate_search_cost_scales_with_results() -> None:
    """Search cost is a per-result constant times the result count."""
    assert estimate_search_cost(0) == 0.0
    assert estimate_search_cost(10) == pytest.approx(0.05)


def test_estimate_llm_cost_scales_per_thousand_tokens() -> None:
    """Model cost is a per-1k-token constant times the token count."""
    assert estimate_llm_cost(0) == 0.0
    assert estimate_llm_cost(2000) == pytest.approx(0.006)


async def test_record_cost_accumulates_run_total(db_url: str) -> None:
    """Recording costs against a run accumulates into its running total."""
    conn = await get_db_connection(db_url)
    try:
        run_id = await _make_run(conn)
        assert await run_cost(conn, run_id) == 0.0
        await record_cost(
            conn, run_id=run_id, kind="search", provider="brave", units=5, estimated_cost=0.25
        )
        await record_cost(
            conn, run_id=run_id, kind="llm", provider="anthropic", units=1000, estimated_cost=0.75
        )
        total = await run_cost(conn, run_id)
    finally:
        await conn.close()

    assert total == 1.0


async def test_daily_cost_sums_only_recent_rows(db_url: str) -> None:
    """daily_cost includes rows recorded at or after the cutoff and ignores older ones."""
    conn = await get_db_connection(db_url)
    try:
        run_id = await _make_run(conn)
        await record_cost(
            conn, run_id=run_id, kind="search", provider="brave", units=5, estimated_cost=2.0
        )
        included = await daily_cost(conn, since_iso="2000-01-01T00:00:00+00:00")
        excluded = await daily_cost(conn, since_iso="2999-01-01T00:00:00+00:00")
    finally:
        await conn.close()

    assert included == 2.0  # noqa: PLR2004
    assert excluded == 0.0


async def test_assert_within_budget_passes_when_under_ceilings(db_url: str) -> None:
    """A run well under both ceilings with the kill switch off does not raise."""
    conn = await get_db_connection(db_url)
    settings = Settings(
        database_url=db_url, discovery_max_run_cost=5.0, discovery_max_daily_cost=50.0
    )
    try:
        run_id = await _make_run(conn)
        await record_cost(
            conn, run_id=run_id, kind="search", provider="brave", units=1, estimated_cost=0.5
        )
        await assert_within_budget(conn, run_id=run_id, settings=settings)
    finally:
        await conn.close()


async def test_assert_within_budget_raises_on_kill_switch(db_url: str) -> None:
    """The kill switch halts spend immediately, before any ceiling math."""
    conn = await get_db_connection(db_url)
    settings = Settings(database_url=db_url, discovery_cost_kill_switch=True)
    try:
        run_id = await _make_run(conn)
        with pytest.raises(CostCeilingExceeded) as exc_info:
            await assert_within_budget(conn, run_id=run_id, settings=settings)
    finally:
        await conn.close()

    assert exc_info.value.scope == "kill_switch"


async def test_assert_within_budget_raises_on_run_ceiling(db_url: str) -> None:
    """Crossing the per-run ceiling raises with the run scope."""
    conn = await get_db_connection(db_url)
    settings = Settings(
        database_url=db_url, discovery_max_run_cost=1.0, discovery_max_daily_cost=50.0
    )
    try:
        run_id = await _make_run(conn)
        await record_cost(
            conn, run_id=run_id, kind="llm", provider="anthropic", units=1, estimated_cost=1.5
        )
        with pytest.raises(CostCeilingExceeded) as exc_info:
            await assert_within_budget(conn, run_id=run_id, settings=settings)
    finally:
        await conn.close()

    assert exc_info.value.scope == "run"


async def test_assert_within_budget_raises_on_daily_ceiling(db_url: str) -> None:
    """Crossing the rolling-daily ceiling raises with the daily scope."""
    conn = await get_db_connection(db_url)
    settings = Settings(
        database_url=db_url, discovery_max_run_cost=100.0, discovery_max_daily_cost=1.0
    )
    try:
        run_id = await _make_run(conn)
        other_run_id = await _make_run(conn)
        await record_cost(
            conn, run_id=other_run_id, kind="llm", provider="anthropic", units=1, estimated_cost=2.0
        )
        with pytest.raises(CostCeilingExceeded) as exc_info:
            await assert_within_budget(conn, run_id=run_id, settings=settings)
    finally:
        await conn.close()

    assert exc_info.value.scope == "daily"
