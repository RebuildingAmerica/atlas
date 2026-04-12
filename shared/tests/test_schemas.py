"""Tests for atlas_shared.schemas."""

from datetime import date, datetime, timezone

from atlas_shared.schemas import (
    CoverageGap,
    DeduplicatedEntry,
    GapReport,
    PageContent,
    RankedEntry,
    RawEntry,
)
from atlas_shared.types import EntityType, GeoSpecificity, SourceType


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
