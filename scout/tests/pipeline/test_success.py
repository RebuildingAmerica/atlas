"""Tests for successful pipeline runs."""

from __future__ import annotations

from pathlib import Path

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import PipelineResult, run_pipeline
from atlas_scout.store import ScoutStore

from .support import MockFetcher, StructuredFetcher, build_mock_provider


@pytest.mark.asyncio
async def test_run_pipeline_returns_result(tmp_db_path: Path):
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=build_mock_provider(),
        store=store,
        direct_urls=["https://example.com/article"],
        fetcher=MockFetcher(),
        follow_links=False,
    )

    assert isinstance(result, PipelineResult)
    assert result.run_id is not None
    assert result.pages_fetched == 1
    assert result.gap_report is not None

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_persists_run(tmp_db_path: Path):
    """The run record should be marked completed in the store."""
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=build_mock_provider(),
        store=store,
        direct_urls=["https://example.com/article"],
        fetcher=MockFetcher(),
        follow_links=False,
    )

    run_record = await store.get_run(result.run_id)
    assert run_record["status"] == "completed"
    assert run_record["location"] == "Austin, TX"
    assert run_record["queries"] == result.queries_generated

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_bulk_saves_ranked_entries(tmp_db_path: Path) -> None:
    """Large structured runs should use the store's batch insert path."""
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    bulk_counts: list[int] = []
    original_bulk_save = store.bulk_save_entries

    async def bulk_save_entries(**kwargs):
        bulk_counts.append(len(kwargs["entries"]))
        return await original_bulk_save(**kwargs)

    async def save_entry(**_kwargs):
        raise AssertionError("run_pipeline should use bulk_save_entries")

    store.bulk_save_entries = bulk_save_entries  # type: ignore[method-assign]
    store.save_entry = save_entry  # type: ignore[method-assign]

    provider = build_mock_provider()
    provider.complete.return_value = type(provider.complete.return_value)(text="[]")

    result = await run_pipeline(
        location="United States",
        issues=["electoral_reform"],
        provider=provider,
        store=store,
        direct_urls=["https://example.gov/candidates.csv"],
        fetcher=StructuredFetcher(),
        follow_links=False,
        min_entry_score=0.0,
    )

    assert len(result.ranked_entries) == 2
    assert bulk_counts == [2]

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_gap_report_not_none(tmp_db_path: Path):
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=build_mock_provider(),
        store=store,
        direct_urls=["https://example.com/article"],
        fetcher=MockFetcher(),
        follow_links=False,
    )

    assert result.gap_report.location == "Austin, TX"
    assert isinstance(result.gap_report.covered_issues, list)
    assert isinstance(result.gap_report.missing_issues, list)
    assert isinstance(result.gap_report.thin_issues, list)

    await store.close()
