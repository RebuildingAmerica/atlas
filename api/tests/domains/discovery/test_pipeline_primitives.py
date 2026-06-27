"""Discovery pipeline primitive behavior tests."""

from __future__ import annotations

from hypothesis import given

from atlas.domains.discovery.pipeline.deduplicator import deduplicate_entries
from atlas.domains.discovery.pipeline.gap_analyzer import analyze_gaps
from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.ranker import rank_entries
from tests.support.hypothesis_strategies import (
    city_names,
    issue_area_slugs,
    state_abbreviations,
)

EXPECTED_TWO_ENTRIES = 2


class TestQueryGeneration:
    """Tests for enriched query generation."""

    def test_generate_queries_expands_local_context(self) -> None:
        """Query generation should include location-specific outlets when configured."""
        queries = generate_queries(
            city="Kansas City",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        query_texts = {query.query for query in queries}
        assert any("Kansas City Star" in query for query in query_texts)
        assert any("KCUR" in query for query in query_texts)


@given(city_names(), state_abbreviations(), issue_area_slugs())
def test_generate_queries_emits_normalized_location_aware_queries(
    city: str,
    state: str,
    issue_area_slug: str,
) -> None:
    """Discovery query generation should stay deterministic and location-aware."""
    queries = generate_queries(city=city, state=state, issue_areas=[issue_area_slug])

    assert queries
    assert all(query.issue_area == issue_area_slug for query in queries)
    assert all(query.query == " ".join(query.query.split()) for query in queries)
    assert all(query.query for query in queries)
    assert all(f"{city}, {state}" in query.query for query in queries)


class TestDeduplication:
    """Tests for deduplication logic."""

    def test_deduplicate_entries_merges_exact_matches_and_unions_fields(self) -> None:
        """Exact same local org found twice should merge into one richer entry."""
        extracted = [
            {
                "name": "Prairie Workers Cooperative",
                "entry_type": "organization",
                "description": "Worker-owned cooperative in Garden City.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "website": "https://prairie.example",
                "email": None,
                "social_media": None,
                "affiliated_org": None,
                "source_urls": ["https://example.com/story-1"],
                "source_dates": ["2026-01-10"],
            },
            {
                "name": "Prairie Workers Cooperative",
                "entry_type": "organization",
                "description": "Worker-owned cooperative employing 45 people after layoffs.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["automation_and_ai_displacement", "worker_cooperatives"],
                "website": "https://prairie.example",
                "email": "info@prairie.example",
                "social_media": {"instagram": "prairiecoop"},
                "affiliated_org": None,
                "source_urls": ["https://example.com/story-2"],
                "source_dates": ["2026-01-15"],
            },
        ]

        result = deduplicate_entries(extracted)

        assert len(result.entries) == 1
        merged = result.entries[0]
        assert merged["email"] == "info@prairie.example"
        assert merged["description"] == extracted[1]["description"]
        assert set(merged["issue_areas"]) == {
            "worker_cooperatives",
            "automation_and_ai_displacement",
        }
        assert set(merged["source_urls"]) == {
            "https://example.com/story-1",
            "https://example.com/story-2",
        }
        assert merged["last_seen"] == "2026-01-15"

    def test_deduplicate_entries_flags_fuzzy_same_city_matches(self) -> None:
        """Fuzzy same-city name matches should be surfaced for review."""
        extracted = [
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "description": "Organizer.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
            {
                "name": "Maria Gonzales",
                "entry_type": "person",
                "description": "Co-op founder.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
        ]

        result = deduplicate_entries(extracted)

        assert len(result.flags) == 1
        assert result.flags[0].entry_indices == [0, 1]

    def test_deduplicate_entries_merges_with_existing_records(self) -> None:
        """Incoming extracted entries should merge into exact existing matches."""
        result = deduplicate_entries(
            [
                {
                    "name": "Existing Org",
                    "entry_type": "organization",
                    "description": "Newer description.",
                    "city": "Kansas City",
                    "state": "MO",
                    "geo_specificity": "local",
                    "issue_areas": ["housing_affordability"],
                    "source_urls": ["https://example.com/new"],
                    "source_dates": ["2026-01-15"],
                }
            ],
            existing=[
                {
                    "id": "existing-id",
                    "name": "Existing Org",
                    "entry_type": "organization",
                    "description": "Older description.",
                    "city": "Kansas City",
                    "state": "MO",
                    "geo_specificity": "local",
                    "issue_areas": ["worker_cooperatives"],
                    "source_urls": ["https://example.com/old"],
                    "source_dates": ["2026-01-10"],
                }
            ],
        )

        assert len(result.entries) == 1
        assert result.entries[0]["name"] == "Existing Org"
        assert set(result.entries[0]["source_urls"]) == {
            "https://example.com/new",
            "https://example.com/old",
        }

    def test_deduplicate_entries_can_flag_one_candidate_then_merge_another(self) -> None:
        """Deduplication should keep scanning after a flag so a later exact match can merge."""
        extracted = [
            {
                "name": "Maria Gonzales",
                "entry_type": "person",
                "description": "Kansas City organizer.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "description": "Wichita organizer.",
                "city": "Wichita",
                "state": "KS",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "description": "Kansas City co-op founder.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["worker_cooperatives"],
                "affiliated_org": "Prairie Workers Cooperative",
            },
        ]

        result = deduplicate_entries(extracted)

        assert result.merges == [[1, 2]]
        assert len(result.flags) == 1
        assert result.flags[0].entry_indices == [0, 2]
        assert len(result.entries) == EXPECTED_TWO_ENTRIES


class TestRanking:
    """Tests for ranking behavior."""

    def test_rank_entries_prefers_density_recency_and_contact_surface(self) -> None:
        """Ranking should prefer stronger, more reachable, more recent entries."""
        entries = [
            {
                "id": "best",
                "name": "Best Entry",
                "geo_specificity": "local",
                "description": (
                    "Detailed local organization building affordable housing with clear "
                    "programs and public contact channels."
                ),
                "website": "https://best.example",
                "email": "contact@best.example",
                "last_seen": "2026-02-01",
            },
            {
                "id": "weaker",
                "name": "Weaker Entry",
                "geo_specificity": "statewide",
                "description": "Advocacy group.",
                "website": None,
                "email": None,
                "last_seen": "2025-01-01",
            },
        ]

        ranked = rank_entries(entries, source_counts={"best": 3, "weaker": 1})

        assert ranked[0].entry["id"] == "best"
        assert ranked[0].score > ranked[1].score
        assert ranked[0].components["source_density"] > ranked[1].components["source_density"]


class TestGapAnalysis:
    """Tests for discovery coverage-gap analysis."""

    def test_analyze_gaps_marks_covered_issues_and_ignores_entries_without_issue_areas(
        self,
    ) -> None:
        """Gap analysis should ignore malformed entries and distinguish covered vs thin issues."""
        report = analyze_gaps(
            "Kansas City, MO",
            [
                {"name": "Malformed atlas entry"},
                {"issue_areas": ["housing_affordability"]},
                {"issue_areas": ["housing_affordability", "worker_cooperatives"]},
                {"issue_areas": ["housing_affordability"]},
            ],
        )

        assert "housing_affordability" in report.covered_issues
        assert "worker_cooperatives" in report.thin_issues
