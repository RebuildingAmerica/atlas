"""Discovery pipeline persistence tests."""

from __future__ import annotations

import importlib
import importlib.util

import pytest
from atlas_shared import (
    DeduplicatedEntry as SharedDeduplicatedEntry,
)
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunManifest,
    DiscoveryRunStats,
    DiscoveryRunStatus,
    GapReport,
    PageContent,
)
from atlas_shared import (
    RankedEntry as SharedRankedEntry,
)

from atlas.models import DiscoveryRunCRUD, SourceCRUD


def _load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")


class TestDiscoveryPersistence:
    """Tests for persisting shared discovery artifacts and run outputs."""

    @pytest.mark.asyncio
    async def test_persist_discovery_results_with_failed_status_uses_update_path(
        self,
        test_db: object,
    ) -> None:
        """When the supplied stats status is not COMPLETED, persist should record via update."""
        runner_module = _load_runner_module()
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        ranked_entry = SharedRankedEntry(
            entry=SharedDeduplicatedEntry(
                name="Failed Run Org",
                entry_type="organization",
                description="Persisted despite a failed run status.",
                city="Kansas City",
                state="MO",
                geo_specificity="local",
                issue_areas=["housing_affordability"],
                source_urls=[],
            ),
            score=0.5,
        )
        stats = DiscoveryRunStats(
            queries_generated=1,
            sources_fetched=0,
            sources_processed=0,
            entries_extracted=1,
            entries_after_dedup=1,
            entries_confirmed=1,
            status=DiscoveryRunStatus.FAILED,
            error_message="search offline",
        )

        confirmed_ids, _sources = await runner_module.persist_discovery_results(
            test_db,
            run_id=run_id,
            ranked_entries=[ranked_entry],
            sources=[],
            stats=stats,
        )

        assert len(confirmed_ids) == 1
        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert run.error_message == "search offline"

    @pytest.mark.asyncio
    async def test_persist_discovery_artifacts_stores_research_summary(
        self,
        test_db: object,
    ) -> None:
        """Completed artifact persistence should leave a source-linked research brief."""
        runner_module = _load_runner_module()
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        artifacts = DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
                status=DiscoveryRunStatus.COMPLETED,
            ),
            stats=DiscoveryRunStats(
                queries_generated=2,
                sources_fetched=1,
                sources_processed=1,
                entries_extracted=1,
                entries_after_dedup=1,
                entries_confirmed=1,
                status=DiscoveryRunStatus.COMPLETED,
            ),
            sources=[
                PageContent(
                    url="https://example.com/agenda",
                    title="Tenant meeting agenda",
                    publication="City Council",
                    text="KC Tenants appears on the agenda.",
                )
            ],
            ranked_entries=[
                SharedRankedEntry(
                    entry=SharedDeduplicatedEntry(
                        name="KC Tenants",
                        entry_type="organization",
                        description="Tenant organization in Kansas City.",
                        city="Kansas City",
                        state="MO",
                        issue_areas=["housing_affordability"],
                        source_urls=["https://example.com/agenda"],
                        source_contexts={
                            "https://example.com/agenda": (
                                "KC Tenants appears on a city meeting agenda."
                            )
                        },
                    ),
                    score=0.92,
                )
            ],
            gap_report=GapReport(
                location="Kansas City, MO",
                total_entries=1,
                thin_issues=["housing_affordability"],
                uncovered_domains=["rural_organizing"],
            ),
        )

        await runner_module.persist_discovery_artifacts(
            test_db,
            run_id=run_id,
            artifacts=artifacts,
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        source = await SourceCRUD.get_by_url(test_db, "https://example.com/agenda")

        assert run is not None
        assert source is not None
        assert run.research_summary is not None
        assert run.research_summary["brief"] == (
            "Kansas City, MO returned 1 ranked lead backed by 1 source."
        )
        assert run.research_summary["ranked_leads"][0]["name"] == "KC Tenants"
        assert run.research_summary["ranked_leads"][0]["source_count"] == 1
        assert run.research_summary["ranked_leads"][0]["confidence"] == "partial"
        assert run.research_summary["key_sources"][0]["source_id"] == source.id
        assert run.research_summary["gaps"][0]["label"] == "Thin issue coverage"
        assert "housing_affordability" in run.research_summary["gaps"][0]["detail"]

    @pytest.mark.asyncio
    async def test_failed_artifact_persistence_does_not_store_research_summary(
        self,
        test_db: object,
    ) -> None:
        """Failed runs should keep operational failure state without a research brief."""
        runner_module = _load_runner_module()
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )
        artifacts = DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
                status=DiscoveryRunStatus.FAILED,
            ),
            stats=DiscoveryRunStats(
                entries_extracted=1,
                entries_after_dedup=1,
                entries_confirmed=1,
                status=DiscoveryRunStatus.FAILED,
                error_message="search offline",
            ),
            ranked_entries=[
                SharedRankedEntry(
                    entry=SharedDeduplicatedEntry(
                        name="Failed Artifact Org",
                        entry_type="organization",
                        description="Persisted from a failed artifact.",
                        city="Kansas City",
                        state="MO",
                        issue_areas=["housing_affordability"],
                        source_urls=[],
                    ),
                    score=0.42,
                )
            ],
        )

        await runner_module.persist_discovery_artifacts(
            test_db,
            run_id=run_id,
            artifacts=artifacts,
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
        assert run is not None
        assert run.status == "failed"
        assert run.research_summary is None

    @pytest.mark.asyncio
    async def test_research_source_payloads_skip_unpersisted_or_untitled_sources(
        self,
        test_db: object,
    ) -> None:
        """Key sources should only include persisted, titled sources."""
        runner_module = _load_runner_module()
        artifacts = DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
                status=DiscoveryRunStatus.COMPLETED,
            ),
            sources=[
                PageContent(url="https://example.com/untitled", title=""),
                PageContent(url="https://example.com/unpersisted", title="Unpersisted"),
            ],
            ranked_entries=[
                SharedRankedEntry(
                    entry=SharedDeduplicatedEntry(
                        name="KC Tenants",
                        entry_type="organization",
                        description="Tenant organization in Kansas City.",
                        city="Kansas City",
                        state="MO",
                        issue_areas=["housing_affordability"],
                        source_urls=[
                            "https://example.com/untitled",
                            "https://example.com/unpersisted",
                        ],
                    ),
                    score=0.92,
                )
            ],
        )
        await SourceCRUD.create(
            test_db,
            url="https://example.com/untitled",
            source_type="news_article",
            extraction_method="autodiscovery",
        )

        payloads = await runner_module._research_source_payloads(test_db, artifacts)  # noqa: SLF001

        assert payloads == []

    def test_research_lead_payload_uses_fallback_reason_without_context(self) -> None:
        """A ranked lead without quoted context still gets an explicit source-count reason."""
        runner_module = _load_runner_module()
        ranked_entry = SharedRankedEntry(
            entry=SharedDeduplicatedEntry(
                name="KC Tenants",
                entry_type="organization",
                description="Tenant organization in Kansas City.",
                city="Kansas City",
                state="MO",
                issue_areas=["housing_affordability"],
                source_urls=["https://example.com/agenda"],
            ),
            score=0.92,
        )

        payload = runner_module._research_lead_payload(ranked_entry, "entry-1")  # noqa: SLF001

        assert payload["why_it_matters"] == "Ranked from 1 supporting source."

    def test_research_gap_payloads_cover_missing_uncovered_and_empty_reports(self) -> None:
        """Gap payloads should cover every shared gap-report variant."""
        runner_module = _load_runner_module()
        empty_artifacts = DiscoveryRunArtifacts(
            manifest=DiscoveryRunManifest(
                runner="atlas-scout",
                run={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
                status=DiscoveryRunStatus.COMPLETED,
            )
        )
        gap_artifacts = DiscoveryRunArtifacts(
            manifest=empty_artifacts.manifest,
            gap_report=GapReport(
                location="Kansas City, MO",
                missing_issues=["worker_cooperatives"],
                uncovered_domains=["labor"],
            ),
        )
        no_gap_artifacts = DiscoveryRunArtifacts(
            manifest=empty_artifacts.manifest,
            gap_report=GapReport(location="Kansas City, MO"),
        )

        assert runner_module._research_gap_payloads(empty_artifacts) == []  # noqa: SLF001
        assert runner_module._research_gap_payloads(no_gap_artifacts) == []  # noqa: SLF001
        gaps = runner_module._research_gap_payloads(gap_artifacts)  # noqa: SLF001
        assert gaps[0]["label"] == "Missing issue coverage"
        assert "worker_cooperatives" in gaps[0]["detail"]
        assert gaps[1]["label"] == "Uncovered domains"
        assert "labor" in gaps[1]["detail"]
