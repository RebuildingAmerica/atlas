"""Tests for atlas_shared.schemas."""

from datetime import date, datetime, timezone

from atlas_shared.schemas import (
    CoverageGap,
    DiscoveryContributionRequest,
    DiscoveryContributionResponse,
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunSyncRequest,
    DiscoveryRunSyncResponse,
    DiscoveryRunStats,
    DiscoverySyncInfo,
    compute_artifact_hash,
    DeduplicatedEntry,
    GapReport,
    PageContent,
    PageTaskOutcome,
    RankedEntry,
    RawEntry,
    RunCheckpoint,
)
from atlas_shared.types import DiscoveryRunStatus, EntityType, GeoSpecificity, SourceType


def test_raw_entry_minimal() -> None:
    """RawEntry should be constructable with only required fields."""
    entry = RawEntry(name="Test Org", entry_type=EntityType.ORGANIZATION)
    assert entry.name == "Test Org"
    assert entry.entry_type == EntityType.ORGANIZATION
    assert entry.description == ""
    assert entry.city is None
    assert entry.state is None
    assert entry.geo_specificity == GeoSpecificity.LOCAL
    assert entry.issue_areas == []
    assert entry.social_media == {}
    assert entry.source_url == ""


def test_raw_entry_full() -> None:
    """RawEntry should accept all fields correctly."""
    entry = RawEntry(
        name="Jane Smith",
        entry_type=EntityType.PERSON,
        description="A labor organizer in Detroit.",
        city="Detroit",
        state="MI",
        geo_specificity=GeoSpecificity.REGIONAL,
        issue_areas=["union_organizing", "worker_cooperatives"],
        region="Midwest",
        website="https://example.org",
        email="jane@example.org",
        social_media={"twitter": "@janesmith"},
        affiliated_org="Detroit Workers United",
        extraction_context="Jane Smith leads the Detroit chapter...",
        source_url="https://news.example.com/article",
    )
    assert entry.name == "Jane Smith"
    assert entry.city == "Detroit"
    assert entry.state == "MI"
    assert entry.geo_specificity == GeoSpecificity.REGIONAL
    assert "union_organizing" in entry.issue_areas
    assert entry.social_media["twitter"] == "@janesmith"
    assert entry.affiliated_org == "Detroit Workers United"


def test_deduplicated_entry_has_source_lists() -> None:
    """DeduplicatedEntry should carry source_urls, source_dates, and source_contexts."""
    today = date.today()
    entry = DeduplicatedEntry(
        name="Green Future KC",
        entry_type=EntityType.ORGANIZATION,
        source_urls=["https://a.com", "https://b.com"],
        source_dates=[today, today],
        source_contexts={
            "https://a.com": "Green Future KC is a local climate group.",
            "https://b.com": "Green Future KC hosted a rally.",
        },
        last_seen=today,
    )
    assert len(entry.source_urls) == 2
    assert len(entry.source_dates) == 2
    assert "https://a.com" in entry.source_contexts
    assert entry.last_seen == today


def test_ranked_entry() -> None:
    """RankedEntry should wrap a DeduplicatedEntry with a score and components."""
    dedup = DeduplicatedEntry(name="Sunrise Movement", entry_type=EntityType.INITIATIVE)
    ranked = RankedEntry(
        entry=dedup,
        score=0.87,
        components={"source_count": 3, "issue_coverage": 0.9},
    )
    assert ranked.score == 0.87
    assert ranked.entry.name == "Sunrise Movement"
    assert ranked.components["source_count"] == 3


def test_discovery_run_input() -> None:
    """DiscoveryRunInput should capture canonical run targeting fields."""
    run = DiscoveryRunInput(
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
    )
    assert run.location_query == "Kansas City, MO"
    assert run.state == "MO"
    assert run.search_depth == "standard"


def test_discovery_contribution_request() -> None:
    """Contribution payloads should carry run info, sources, and ranked entries together."""
    entry = RankedEntry(
        entry=DeduplicatedEntry(
            name="Prairie Workers Cooperative",
            entry_type=EntityType.ORGANIZATION,
            source_urls=["https://example.com/story"],
            source_dates=[date(2026, 1, 15)],
            source_contexts={"https://example.com/story": "Worker-owned cooperative in Garden City."},
            last_seen=date(2026, 1, 15),
        ),
        score=0.91,
    )
    source = PageContent(
        url="https://example.com/story",
        title="Prairie workers launch co-op",
        text="A new worker-owned cooperative opened in Garden City...",
        source_type=SourceType.NEWS_ARTICLE,
    )
    payload = DiscoveryContributionRequest(
        run=DiscoveryRunInput(
            location_query="Garden City, KS",
            state="KS",
            issue_areas=["worker_cooperatives"],
        ),
        stats=DiscoveryRunStats(entries_after_dedup=1, entries_confirmed=1),
        sources=[source],
        ranked_entries=[entry],
    )
    assert payload.stats.status == DiscoveryRunStatus.COMPLETED
    assert payload.sources[0].url == "https://example.com/story"
    assert payload.ranked_entries[0].entry.source_urls == ["https://example.com/story"]


def test_discovery_contribution_response() -> None:
    """Contribution responses should expose run id, status, and persistence counts."""
    response = DiscoveryContributionResponse(
        run_id="run_123",
        status=DiscoveryRunStatus.COMPLETED,
        entries_persisted=2,
        sources_persisted=3,
    )
    assert response.run_id == "run_123"
    assert response.status == DiscoveryRunStatus.COMPLETED
    assert response.entries_persisted == 2


def test_discovery_run_artifacts_bundle() -> None:
    """DiscoveryRunArtifacts should bundle manifest, checkpoints, page tasks, and outputs."""
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Garden City, KS",
                state="KS",
                issue_areas=["worker_cooperatives"],
            ),
            status=DiscoveryRunStatus.COMPLETED,
            sync=DiscoverySyncInfo(local_run_id="local_123", sync_status="pending"),
        ),
        checkpoints=[
            RunCheckpoint(
                phase="fetching",
                status=DiscoveryRunStatus.RUNNING,
                metrics={"pages_fetched": 2},
            )
        ],
        page_tasks=[
            PageTaskOutcome(
                task_id="task_1",
                url="https://example.com/story",
                status="completed",
                depth=0,
                entries_extracted=1,
                user_visible=True,
            )
        ],
        raw_entries=[
            RawEntry(
                name="Prairie Workers Cooperative",
                entry_type=EntityType.ORGANIZATION,
                source_url="https://example.com/story",
            )
        ],
    )
    assert artifacts.manifest.runner == "atlas-scout"
    assert artifacts.manifest.sync is not None
    assert artifacts.manifest.sync.local_run_id == "local_123"
    assert artifacts.checkpoints[0].phase == "fetching"
    assert artifacts.page_tasks[0].user_visible is True


def test_discovery_run_sync_payload_and_hash() -> None:
    """Run-sync models should carry the bundle and compute a stable mutable-safe hash."""
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Garden City, KS",
                state="KS",
                issue_areas=["worker_cooperatives"],
            ),
            status=DiscoveryRunStatus.COMPLETED,
            sync=DiscoverySyncInfo(local_run_id="local_123", sync_status="pending"),
        )
    )

    first_hash = compute_artifact_hash(artifacts)
    second_hash = compute_artifact_hash(
        artifacts.model_copy(
            update={
                "manifest": artifacts.manifest.model_copy(
                    update={
                        "sync": DiscoverySyncInfo(
                            local_run_id="local_123",
                            sync_status="synced",
                            remote_run_id="remote_456",
                        )
                    }
                )
            }
        )
    )

    payload = DiscoveryRunSyncRequest(artifacts=artifacts)
    response = DiscoveryRunSyncResponse(
        run_id="remote_456",
        status=DiscoveryRunStatus.COMPLETED,
        sync_status="synced",
        entries_persisted=2,
        sources_persisted=3,
    )

    assert payload.artifacts.manifest.runner == "atlas-scout"
    assert response.run_id == "remote_456"
    assert first_hash == second_hash


def test_coverage_gap_defaults() -> None:
    """CoverageGap should have sensible defaults for entry_count and severity."""
    gap = CoverageGap(
        issue_area_slug="rural_healthcare_and_services",
        issue_area_name="Rural Healthcare and Services",
    )
    assert gap.entry_count == 0
    assert gap.severity == 0.0


def test_gap_report() -> None:
    """GapReport should aggregate coverage information correctly."""
    report = GapReport(
        location="Kansas City, MO",
        total_entries=42,
        covered_issues=["housing_affordability"],
        missing_issues=["energy_transition"],
        thin_issues=["union_organizing"],
        uncovered_domains=["Rural-Urban Divide"],
    )
    assert report.location == "Kansas City, MO"
    assert report.total_entries == 42
    assert "housing_affordability" in report.covered_issues
    assert "energy_transition" in report.missing_issues


def test_page_content() -> None:
    """PageContent should accept URL as required field with sensible defaults."""
    page = PageContent(url="https://example.com/article")
    assert page.url == "https://example.com/article"
    assert page.title == ""
    assert page.text == ""
    assert page.publication is None
    assert page.published_date is None
    assert page.source_type == SourceType.WEBSITE


def test_page_content_full() -> None:
    """PageContent should accept all fields."""
    pub_date = datetime(2026, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
    page = PageContent(
        url="https://news.example.com/story",
        title="Local Co-op Opens in Detroit",
        text="A new worker cooperative opened its doors...",
        publication="Detroit Free Press",
        published_date=pub_date,
        source_type=SourceType.NEWS_ARTICLE,
    )
    assert page.title == "Local Co-op Opens in Detroit"
    assert page.publication == "Detroit Free Press"
    assert page.source_type == SourceType.NEWS_ARTICLE
    assert page.published_date == pub_date
