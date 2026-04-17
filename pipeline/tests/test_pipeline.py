"""Tests for the streaming pipeline orchestrator."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest
from atlas_shared import PageContent

from atlas_scout.pipeline import PipelineResult, _parse_location, run_pipeline
from atlas_scout.providers.base import Completion, Message

if TYPE_CHECKING:
    from pathlib import Path


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_provider():
    """Return a mock LLM provider that extracts a single test org."""
    provider = AsyncMock()
    provider.max_concurrent = 5
    provider.complete.return_value = Completion(
        text=json.dumps(
            [
                {
                    "name": "Test Org",
                    "type": "organization",
                    "description": (
                        "A test organization working on housing issues in Austin Texas"
                    ),
                    "city": "Austin",
                    "state": "TX",
                    "geo_specificity": "local",
                    "issue_areas": ["housing_affordability"],
                    "website": "https://test.org",
                    "email": "info@test.org",
                    "social_media": None,
                    "affiliated_org": None,
                    "extraction_context": "Test org was mentioned...",
                }
            ]
        ),
        parsed=None,
    )
    return provider


@pytest.fixture
def mock_fetcher():
    """Return a mock AsyncFetcher that returns a single page."""
    fetcher = AsyncMock()
    fetcher.fetch.return_value = PageContent(
        url="https://example.com/article",
        text="Article about Test Org housing advocacy in Austin " * 50,
        title="Housing News",
    )
    return fetcher


# ---------------------------------------------------------------------------
# _parse_location
# ---------------------------------------------------------------------------


def test_parse_location_city_state():
    city, state = _parse_location("Austin, TX")
    assert city == "Austin"
    assert state == "TX"


def test_parse_location_city_only():
    city, state = _parse_location("Austin")
    assert city == "Austin"
    assert state == ""


def test_parse_location_strips_whitespace():
    city, state = _parse_location("  Kansas City , MO  ")
    assert city == "Kansas City"
    assert state == "MO"


def test_parse_location_with_comma_in_state():
    # Only splits on first comma
    city, state = _parse_location("St. Louis, MO")
    assert city == "St. Louis"
    assert state == "MO"


# ---------------------------------------------------------------------------
# run_pipeline happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_returns_result(mock_provider, mock_fetcher, tmp_db_path: Path):
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=mock_provider,
        store=store,
        search_api_key="test-key",
        fetcher=mock_fetcher,
    )

    assert isinstance(result, PipelineResult)
    assert result.run_id is not None
    assert result.queries_generated > 0
    assert result.gap_report is not None

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_persists_run(mock_provider, mock_fetcher, tmp_db_path: Path):
    """The run record should be marked completed in the store."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=mock_provider,
        store=store,
        search_api_key="test-key",
        fetcher=mock_fetcher,
    )

    run_record = await store.get_run(result.run_id)
    assert run_record["status"] == "completed"
    assert run_record["location"] == "Austin, TX"
    assert run_record["queries"] == result.queries_generated

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_gap_report_not_none(mock_provider, mock_fetcher, tmp_db_path: Path):
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=mock_provider,
        store=store,
        search_api_key="test-key",
        fetcher=mock_fetcher,
    )

    assert result.gap_report.location == "Austin, TX"
    assert isinstance(result.gap_report.covered_issues, list)
    assert isinstance(result.gap_report.missing_issues, list)
    assert isinstance(result.gap_report.thin_issues, list)

    await store.close()


# ---------------------------------------------------------------------------
# run_pipeline failure path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_marks_run_failed_on_error(mock_provider, mock_fetcher, tmp_db_path: Path):
    """When the pipeline raises an unhandled error, the run should be marked 'failed'."""
    from unittest.mock import patch

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    # Patch analyze_gaps (step 6) to raise — it runs after all streaming is complete,
    # so this is a reliable way to trigger the failure path without depending on
    # internals of earlier steps that swallow their own exceptions.
    with patch(
        "atlas_scout.pipeline.analyze_gaps",
        side_effect=RuntimeError("gap analysis exploded"),
    ), pytest.raises(RuntimeError, match="gap analysis exploded"):
        await run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=mock_provider,
            store=store,
            search_api_key="test-key",
            fetcher=mock_fetcher,
        )

    runs = await store.list_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "failed"
    assert "gap analysis exploded" in runs[0]["error"]

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_marks_run_cancelled_on_interrupt(
    mock_provider,
    mock_fetcher,
    tmp_db_path: Path,
):
    from unittest.mock import patch

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def cancelled_rank(*_args, **_kwargs):
        raise asyncio.CancelledError()
        yield  # pragma: no cover

    with patch("atlas_scout.pipeline.rank_entries_stream", side_effect=cancelled_rank), pytest.raises(
        asyncio.CancelledError
    ):
        await run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=mock_provider,
            store=store,
            search_api_key="test-key",
            fetcher=mock_fetcher,
        )

    runs = await store.list_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "cancelled"

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_cancels_workers_before_returning_on_interrupt(
    tmp_db_path: Path,
):
    from atlas_scout.store import ScoutStore

    started = asyncio.Event()

    class _SinglePageFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
            return PageContent(
                url=url,
                title="Seed",
                text="Tenant defense organizers are active locally. " * 80,
                task_id=task_id,
            )

    class _BlockingProvider:
        max_concurrent = 1

        async def complete(
            self,
            _messages: list[Message],
            _response_schema=None,
        ) -> Completion:
            started.set()
            await asyncio.Future()
            return Completion(text="[]")  # pragma: no cover

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    task = asyncio.create_task(
        run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=_BlockingProvider(),
            store=store,
            direct_urls=["https://example.com/seed"],
            fetcher=_SinglePageFetcher(),
        )
    )

    await asyncio.wait_for(started.wait(), timeout=1.0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    await asyncio.sleep(0)

    worker_tasks = [
        pending
        for pending in asyncio.all_tasks()
        if pending is not asyncio.current_task()
        and getattr(pending.get_coro(), "__name__", "") in {"fetch_worker", "extract_worker"}
        and not pending.done()
    ]
    assert worker_tasks == []

    runs = await store.list_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "cancelled"

    await store.close()


# ---------------------------------------------------------------------------
# PipelineResult dataclass
# ---------------------------------------------------------------------------


def test_pipeline_result_fields():
    from atlas_shared import GapReport

    gap_report = GapReport(location="Test, TX", total_entries=0)
    result = PipelineResult(
        run_id="abc123",
        queries_generated=10,
        pages_fetched=5,
        entries_found=3,
        entries_after_dedup=2,
        ranked_entries=[],
        gap_report=gap_report,
    )
    assert result.run_id == "abc123"
    assert result.queries_generated == 10
    assert result.entries_found == 3
