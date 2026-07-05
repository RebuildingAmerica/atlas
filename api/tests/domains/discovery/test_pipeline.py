"""Pipeline behavior tests."""

from __future__ import annotations

import importlib
import importlib.util

import httpx
import pytest
from atlas_shared import RawEntry

from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import (
    FetchedSource,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.config import Settings

EXPECTED_TWO_RECORDS = 2
EXPECTED_ACCEPTED_STATUS = 202
SEARCH_OFFLINE_ERROR = "search offline"


def _load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")


class TestDiscoveryRunner:
    """Tests for end-to-end discovery execution."""

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_persists_source_linked_results(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A run should fetch, extract, deduplicate, persist, and complete."""
        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/story-1",
                    title="Story One",
                    publication="Kansas City Star",
                    published_date="2026-01-10",
                    content="Story one content",
                    source_type="news_article",
                ),
                FetchedSource(
                    url="https://example.com/story-2",
                    title="Story Two",
                    publication="KCUR",
                    published_date="2026-01-15",
                    content="Story two content",
                    source_type="news_article",
                ),
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Prairie Workers Cooperative",
                    entry_type="organization",
                    description="Worker-owned cooperative employing 45 people after layoffs.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["worker_cooperatives", "housing_affordability"],
                    website="https://prairie.example",
                    email="info@prairie.example",
                    extraction_context="Prairie Workers Cooperative now employs 45 people.",
                )
            ]

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["worker_cooperatives", "housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["worker_cooperatives", "housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.queries_generated > 0
        assert run.sources_fetched == EXPECTED_TWO_RECORDS
        assert run.sources_processed == EXPECTED_TWO_RECORDS
        assert run.entries_extracted == EXPECTED_TWO_RECORDS
        assert run.entries_after_dedup == 1

        # The trust gate holds an uncorroborated web-only org: it is persisted with
        # its sources but stays out of public search until a curator approves it.
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        public_results = await EntryCRUD.search_public(test_db, states=["MO"])
        assert public_results["total"] == 0

        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert len(pending) == 1
        assert pending[0].hold_reason == "uncorroborated_web_only"

        held_entry, sources = await EntryCRUD.get_with_sources(test_db, pending[0].entity_id)
        assert held_entry is not None
        assert held_entry.name == "Prairie Workers Cooperative"
        assert held_entry.active is False
        assert len(sources) == EXPECTED_TWO_RECORDS

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_meters_search_and_model_spend(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A completed run records search and model spend against the cost ledger."""
        from atlas.domains.discovery.cost import run_cost

        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _provider: object = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/metered",
                    title="Metered Story",
                    publication="KCUR",
                    published_date="2026-01-15",
                    content="Metered story content",
                    source_type="news_article",
                )
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return []

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
            settings=Settings(database_url="sqlite:///tmp/test.db"),
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "completed"
        assert await run_cost(test_db, run_id) > 0.0

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_stops_cleanly_at_a_cost_ceiling(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Crossing a ceiling ends the run as a controlled stop, not an exception storm."""
        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _provider: object = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/expensive",
                    title="Expensive Story",
                    publication="KCUR",
                    published_date="2026-01-15",
                    content="Expensive story content",
                    source_type="news_article",
                )
            ]

        extraction_calls = {"count": 0}

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            extraction_calls["count"] += 1
            return []

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        # A near-zero ceiling trips after the first metered call.
        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
            settings=Settings(
                database_url="sqlite:///tmp/test.db",
                discovery_max_run_cost=0.001,
            ),
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert run.error_message is not None
        assert run.error_message.startswith("cost_ceiling")
        # The controlled stop halts before any model spend on this source.
        assert extraction_calls["count"] == 0

    @pytest.mark.asyncio
    async def test_run_discovery_pipeline_stops_immediately_on_kill_switch(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The kill switch halts a run before any search spend is incurred."""
        runner_module = _load_runner_module()
        fetch_calls = {"count": 0}

        async def fake_fetch_sources(
            _queries: list[object],
            _provider: object = None,
        ) -> list[FetchedSource]:
            fetch_calls["count"] += 1
            return []

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(search_api_key="test-search-key"),
            settings=Settings(
                database_url="sqlite:///tmp/test.db",
                discovery_cost_kill_switch=True,
            ),
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert run.error_message == "cost_ceiling:kill_switch"
        assert fetch_calls["count"] == 0


class TestDiscoveryApiIntegration:
    """Tests for API-triggered discovery execution."""

    @pytest.mark.asyncio
    async def test_start_discovery_run_can_execute_inline(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Inline mode should run the pipeline before returning the response."""
        from atlas.main import create_app
        from atlas.platform.config import get_settings

        async def fake_runner(**_kwargs: object) -> None:
            job = _kwargs["job"]
            conn = await _get_db_connection(db_url)
            try:
                run = await DiscoveryRunCRUD.get_by_id(conn, job.run_id)
                assert run is not None
                entry_id = await EntryCRUD.create(
                    conn,
                    entry_type="organization",
                    name="Inline Discovery Result",
                    description="Created during inline execution.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                )
                await conn.execute(
                    """
                    INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
                    VALUES (?, ?, datetime('now'))
                    """,
                    (entry_id, "housing_affordability"),
                )
                await conn.commit()
                await DiscoveryRunCRUD.complete(
                    conn, job.run_id, queries_generated=1, entries_confirmed=1
                )
            finally:
                await conn.close()

        monkeypatch.setattr(
            "atlas.domains.discovery.run_creation.run_discovery_pipeline_for_run", fake_runner
        )

        settings = Settings(
            database_url=db_url,
            anthropic_api_key="test-key",
            search_api_key="test-search",
            discovery_inline=True,
            deploy_mode="local",
        )
        app = create_app()
        app.dependency_overrides[get_settings] = lambda: settings

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/discovery-runs",
                json={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
            )

        assert response.status_code == EXPECTED_ACCEPTED_STATUS
        data = response.json()
        assert data["status"] == "completed"
        assert data["entries_confirmed"] == 1


async def _get_db_connection(database_url: str) -> object:
    """Import lazily to avoid cluttering the top-level test dependencies."""
    from atlas.models import get_db_connection

    return await get_db_connection(database_url)
