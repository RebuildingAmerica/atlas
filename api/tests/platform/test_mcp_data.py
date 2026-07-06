"""Coverage tests for `atlas.platform.mcp.data`.

Drives the AtlasDataService methods, helper functions, and DatabaseSession
context manager against a real SQLite test database. Focuses on branch
coverage for normalization, freshness scoring, and relationship derivation.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
import pytest_asyncio

from atlas.domains.catalog.models.entry import EntryCRUD, EntryModel
from atlas.domains.catalog.models.source import SourceCRUD
from atlas.domains.moderation.models import FlagCRUD
from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import (
    AGING_DAYS,
    FRESHNESS_DAYS,
    AtlasDataService,
    DatabaseSession,
    EntityRecordContext,
    normalize_place_key,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    import aiosqlite


EXPECTED_DISTINCT_DOMAINS = 2
EXPECTED_THREE_SOURCES = 3
EXPECTED_TWO_CONTACT_SOURCES = 2
EXPECTED_TWO_RELATED_ENTITIES = 2


@pytest.mark.asyncio
async def test_data_service_exposes_discovery_runs_for_agent_clients(
    db_url: str, test_db: object
) -> None:
    """MCP data service should expose structured research artifacts from discovery runs."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    run_id = await DiscoveryRunCRUD.create(
        conn,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="interview_leads",
    )
    await DiscoveryRunCRUD.complete(
        conn,
        run_id,
        queries_generated=4,
        sources_fetched=3,
        sources_processed=3,
        entries_extracted=2,
        entries_after_dedup=2,
        entries_confirmed=1,
    )
    await DiscoveryRunCRUD.update_research_summary(
        conn,
        run_id,
        {
            "brief": "One source-backed housing lead in Kansas City.",
            "ranked_leads": [
                {
                    "entry_id": "entry-1",
                    "name": "KC Tenants",
                    "type": "organization",
                    "why_it_matters": "Named in local coverage.",
                    "source_count": 2,
                    "latest_source_date": "2026-04-15",
                }
            ],
            "key_sources": [],
            "gaps": [{"label": "Rural coverage", "detail": "No county lead yet."}],
            "reasoning_signals": ["Ranked 1 lead.", "Flagged 1 gap."],
        },
    )

    service = AtlasDataService(db_url)
    collection = await service.list_discovery_runs(state="MO", status="completed")
    detail = await service.get_discovery_run(run_id)

    assert collection["items"][0]["id"] == run_id
    assert collection["items"][0]["research_summary"]["brief"] == (
        "One source-backed housing lead in Kansas City."
    )
    assert detail["research_summary"]["ranked_leads"][0]["name"] == "KC Tenants"
    assert detail["resource_uri"] == f"atlas://discovery-runs/{run_id}"


@pytest_asyncio.fixture
async def populated_service(db_url: str, test_db: object) -> AsyncIterator[AtlasDataService]:
    """Build an AtlasDataService backed by a populated test database.

    Inserts two organizations in Gary, IN linked through `affiliated_org_id`,
    each tagged with overlapping issue areas and shared/distinct sources, so
    every branch in `get_related_entities` and `get_place_*` exercises real
    rows.
    """
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    primary_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Atlas Primary Org",
        description="Primary org for MCP data coverage.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        website="https://primary.example",
    )
    related_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Atlas Related Org",
        description="Related org sharing place and issues.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=primary_id,
    )
    # Mark primary as Atlas-verified so the "atlas-verified" claim branch hits.
    await EntryCRUD.update(conn, primary_id, verified=True)

    iso_now = datetime.now(UTC).isoformat()
    for entry_id in (primary_id, related_id):
        await conn.execute(
            "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
            (entry_id, "housing_affordability", iso_now),
        )
    # Issue area only on primary so shared_issue_area filter still produces
    # one shared slug between the two entries.
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
        (primary_id, "worker_cooperatives", iso_now),
    )
    await conn.commit()

    fresh_source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/fresh",
        source_type="news_article",
        extraction_method="manual",
        title="Fresh article",
        publication="Example Times",
        published_date=date.today(),  # noqa: DTZ011
    )
    aging_source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/aging",
        source_type="report",
        extraction_method="manual",
        title="Aging report",
        publication="Example Journal",
        published_date=date.today() - timedelta(days=FRESHNESS_DAYS + 30),  # noqa: DTZ011
    )
    await SourceCRUD.link_to_entry(
        conn, primary_id, fresh_source_id, extraction_context="primary fresh"
    )
    await SourceCRUD.link_to_entry(conn, related_id, fresh_source_id)
    await SourceCRUD.link_to_entry(conn, primary_id, aging_source_id)
    await conn.commit()

    # Open flag on primary to populate flag_summary branches.
    await FlagCRUD.create_entity_flag(conn, entity_id=primary_id, reason="duplicate")
    await FlagCRUD.create_source_flag(conn, source_id=fresh_source_id, reason="incorrect")

    yield AtlasDataService(db_url)


def _build_entry(  # noqa: PLR0913
    *,
    entry_id: str = "entry-1",
    claim_status: str = "unclaimed",
    verified: bool = False,
    claimed_by_user_id: str | None = None,
    claim_verified_at: str | None = None,
    last_verified: date | None = None,
    last_confirmed_at: str | None = None,
    affiliated_org_id: str | None = None,
    suppressed_source_ids: list[str] | None = None,
) -> EntryModel:
    """Construct an EntryModel directly so we can hit `_entity_record` helpers."""
    today = date.today()  # noqa: DTZ011
    return EntryModel(
        id=entry_id,
        type="organization",
        name="Helper Org",
        description="Helper org for unit branches.",
        city="Gary",
        state="IN",
        region=None,
        geo_specificity="local",
        latitude=None,
        longitude=None,
        geocode_precision=None,
        geocode_source=None,
        full_address=None,
        website=None,
        email=None,
        phone=None,
        social_media=None,
        affiliated_org_id=affiliated_org_id,
        active=True,
        verified=verified,
        last_verified=last_verified,
        contact_status="not_contacted",
        editorial_notes=None,
        priority=None,
        first_seen=today,
        last_seen=today,
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-02T00:00:00+00:00",
        slug="helper-org-aaaa",
        claim_status=claim_status,
        claimed_by_user_id=claimed_by_user_id,
        claim_verified_at=claim_verified_at,
        last_confirmed_at=last_confirmed_at,
        suppressed_source_ids=suppressed_source_ids or [],
    )


# ---------------------------------------------------------------------------
# Place-normalization helpers
# ---------------------------------------------------------------------------


class TestNormalizePlace:
    """`_normalize_place` should accept None, str, and Mapping shapes."""

    def test_none_returns_blank_address(self) -> None:
        assert data_module._normalize_place(None) == {  # noqa: SLF001
            "city": None,
            "state": None,
            "region": None,
            "display": None,
        }

    def test_two_letter_string_treated_as_state(self) -> None:
        result = data_module._normalize_place("ca")  # noqa: SLF001
        assert result == {"city": None, "state": "CA", "region": None, "display": "CA"}

    def test_city_state_string(self) -> None:
        result = data_module._normalize_place("Gary, Indiana")  # noqa: SLF001
        assert result == {
            "city": "Gary",
            "state": "IN",
            "region": None,
            "display": "Gary, IN",
        }

    def test_city_only_string(self) -> None:
        result = data_module._normalize_place("Gary")  # noqa: SLF001
        assert result["city"] == "Gary"
        assert result["state"] is None
        assert result["display"] == "Gary"

    def test_mapping_with_explicit_display(self) -> None:
        result = data_module._normalize_place(  # noqa: SLF001
            {"city": " Gary ", "state": "indiana", "region": "Lake", "display": "Custom"}
        )
        assert result == {
            "city": "Gary",
            "state": "IN",
            "region": "Lake",
            "display": "Custom",
        }

    def test_mapping_without_display_falls_back_to_format(self) -> None:
        result = data_module._normalize_place({"city": "Gary", "state": "IN"})  # noqa: SLF001
        assert result["display"] == "Gary, IN"

    def test_mapping_region_only(self) -> None:
        result = data_module._normalize_place({"region": "Northwest"})  # noqa: SLF001
        assert result == {
            "city": None,
            "state": None,
            "region": "Northwest",
            "display": "Northwest",
        }


class TestNormalizePlaceKey:
    def test_state_only_key(self) -> None:
        assert normalize_place_key("ut") == {
            "city": None,
            "state": "UT",
            "region": None,
            "display": "UT",
        }

    def test_city_state_key(self) -> None:
        assert normalize_place_key("gary-in") == {
            "city": "Gary",
            "state": "IN",
            "region": None,
            "display": "Gary, IN",
        }

    def test_unsupported_single_segment_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported place key"):
            normalize_place_key("gary")


class TestNormalizeState:
    def test_none_returns_none(self) -> None:
        assert data_module._normalize_state(None) is None  # noqa: SLF001

    def test_blank_returns_none(self) -> None:
        assert data_module._normalize_state("   ") is None  # noqa: SLF001

    def test_full_name_resolves_to_code(self) -> None:
        assert data_module._normalize_state("California") == "CA"  # noqa: SLF001

    def test_two_letter_uppercases(self) -> None:
        assert data_module._normalize_state("ca") == "CA"  # noqa: SLF001

    def test_unknown_returns_none(self) -> None:
        # Only state names in `_STATE_NAMES` resolve; otherwise return None.
        assert data_module._normalize_state("Atlantis") is None  # noqa: SLF001


# ---------------------------------------------------------------------------
# Cursor and validation helpers
# ---------------------------------------------------------------------------
# decode_cursor/encode_cursor now live in atlas.platform.mcp.pagination and are
# covered by tests/platform/test_mcp_pagination.py.


class TestValidateIssueAreas:
    def test_none_returns_empty_list(self) -> None:
        assert data_module._validate_issue_areas(None) == []  # noqa: SLF001

    def test_known_passes_through(self) -> None:
        assert data_module._validate_issue_areas(["housing_affordability"]) == [  # noqa: SLF001
            "housing_affordability"
        ]

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid issue area"):
            data_module._validate_issue_areas(["not-a-real-issue"])  # noqa: SLF001


# ---------------------------------------------------------------------------
# Tokenization, freshness, place URI helpers
# ---------------------------------------------------------------------------


class TestTokenize:
    def test_strips_punctuation_and_lowercases(self) -> None:
        assert data_module._tokenize("Hello, World! 123") == ["hello", "world", "123"]  # noqa: SLF001


class TestStaleness:
    def test_unknown_when_no_reference(self) -> None:
        status, reason = data_module._staleness(None, "entity data")  # noqa: SLF001
        assert status == "unknown"
        assert "No date" in reason

    def test_fresh_within_window(self) -> None:
        today = datetime.now(UTC).date().isoformat()
        status, _ = data_module._staleness(today, "entity data")  # noqa: SLF001
        assert status == "fresh"

    def test_aging_when_past_freshness(self) -> None:
        target = (datetime.now(UTC).date() - timedelta(days=FRESHNESS_DAYS + 5)).isoformat()
        status, _ = data_module._staleness(target, "entity data")  # noqa: SLF001
        assert status == "aging"

    def test_stale_when_past_aging(self) -> None:
        target = (datetime.now(UTC).date() - timedelta(days=AGING_DAYS + 5)).isoformat()
        status, _ = data_module._staleness(target, "entity data")  # noqa: SLF001
        assert status == "stale"

    def test_invalid_string_returns_unknown(self) -> None:
        status, reason = data_module._staleness("not-a-date", "entity data")  # noqa: SLF001
        assert status == "unknown"
        assert "No date" in reason


class TestCoerceDate:
    def test_none(self) -> None:
        assert data_module._coerce_date(None) is None  # noqa: SLF001

    def test_invalid(self) -> None:
        assert data_module._coerce_date("not-a-date") is None  # noqa: SLF001

    def test_iso(self) -> None:
        assert data_module._coerce_date("2026-04-30") == date(2026, 4, 30)  # noqa: SLF001


class TestStringOrNone:
    def test_none_passthrough(self) -> None:
        assert data_module._string_or_none(None) is None  # noqa: SLF001

    def test_int_to_str(self) -> None:
        assert data_module._string_or_none(42) == "42"  # noqa: SLF001


class TestFormatPlace:
    def test_city_state(self) -> None:
        assert data_module._format_place("Gary", "IN", None) == "Gary, IN"  # noqa: SLF001

    def test_city_only(self) -> None:
        assert data_module._format_place("Gary", None, None) == "Gary"  # noqa: SLF001

    def test_region_only(self) -> None:
        assert data_module._format_place(None, None, "Northwest") == "Northwest"  # noqa: SLF001

    def test_state_only(self) -> None:
        assert data_module._format_place(None, "IN", None) == "IN"  # noqa: SLF001

    def test_all_none_returns_none(self) -> None:
        assert data_module._format_place(None, None, None) is None  # noqa: SLF001


class TestPlaceResourceUri:
    def test_state_only_uri(self) -> None:
        assert (
            data_module._place_resource_uri({"city": None, "state": "IN"}, "profile")  # noqa: SLF001
            == "atlas://states/IN/profile"
        )

    def test_city_state_uri(self) -> None:
        uri = data_module._place_resource_uri(  # noqa: SLF001
            {"city": "Gary", "state": "IN", "region": None}, "coverage"
        )
        assert uri == "atlas://cities/gary-in/coverage"


class TestRelationshipIds:
    def test_includes_affiliate_when_present(self) -> None:
        entry = _build_entry(affiliated_org_id="org-2")
        ids = data_module._relationship_ids("entity-1", entry, ["housing_affordability"])  # noqa: SLF001
        assert any("affiliated_organization" in rid for rid in ids)
        assert any("shared_issue_area" in rid for rid in ids)

    def test_no_affiliate_means_no_affiliate_uri(self) -> None:
        entry = _build_entry(affiliated_org_id=None)
        ids = data_module._relationship_ids("entity-1", entry, [])  # noqa: SLF001
        assert ids == []


class TestLatestSourceDate:
    def test_returns_published_date_when_present(self) -> None:
        sources = [{"published_date": "2026-01-15", "ingested_at": None}]
        assert data_module._latest_source_date(sources, "fallback") == "2026-01-15"  # noqa: SLF001

    def test_falls_back_to_ingested_at(self) -> None:
        sources = [{"published_date": None, "ingested_at": "2026-02-20T12:34:56Z"}]
        assert data_module._latest_source_date(sources, "fallback") == "2026-02-20"  # noqa: SLF001

    def test_returns_fallback_when_nothing(self) -> None:
        assert data_module._latest_source_date([], "fallback-date") == "fallback-date"  # noqa: SLF001

    def test_skips_when_neither_field(self) -> None:
        sources = [{"published_date": None, "ingested_at": None}]
        assert data_module._latest_source_date(sources, "fallback-date") == "fallback-date"  # noqa: SLF001


# ---------------------------------------------------------------------------
# `_entity_record` claim-status branches
# ---------------------------------------------------------------------------


class TestEntityRecordClaimVariants:
    def test_subject_verified_when_claim_status_verified(self) -> None:
        entry = _build_entry(claim_status="verified", claimed_by_user_id="user-1")
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
            ),
        )
        assert record["claim"]["verification_level"] == "subject-verified"

    def test_atlas_verified_when_verified_flag(self) -> None:
        entry = _build_entry(verified=True)
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
            ),
        )
        assert record["claim"]["verification_level"] == "atlas-verified"

    def test_source_derived_default(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
                flag_summary={"flag_count": 1, "open_flag_count": 1, "has_open_flags": True},
            ),
        )
        assert record["claim"]["verification_level"] == "source-derived"
        assert record["flag_summary"]["flag_count"] == 1


class TestProfileUrl:
    """`_entity_record` computes an absolute `profile_url` from the configured public origin."""

    def test_none_when_public_url_not_configured(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
            ),
        )
        assert record["profile_url"] is None

    def test_none_when_slug_missing(self) -> None:
        entry = replace(_build_entry(), slug=None)
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
                public_url="https://atlas.rebuildingus.org",
            ),
        )
        assert record["profile_url"] is None

    def test_organization_route_segment(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
                public_url="https://atlas.rebuildingus.org",
            ),
        )
        assert (
            record["profile_url"]
            == "https://atlas.rebuildingus.org/profiles/organizations/helper-org-aaaa"
        )

    def test_person_route_segment(self) -> None:
        entry = replace(_build_entry(), type="person", slug="jane-doe-a3f2")
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
                public_url="https://atlas.rebuildingus.org",
            ),
        )
        assert (
            record["profile_url"] == "https://atlas.rebuildingus.org/profiles/people/jane-doe-a3f2"
        )

    def test_unmapped_type_falls_back_to_pluralized_segment(self) -> None:
        entry = replace(_build_entry(), type="campaign", slug="rent-strike-2026")
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
                public_url="https://atlas.rebuildingus.org",
            ),
        )
        assert (
            record["profile_url"]
            == "https://atlas.rebuildingus.org/profiles/campaigns/rent-strike-2026"
        )

    def test_strips_trailing_slash_from_public_url(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
                public_url="https://atlas.rebuildingus.org/",
            ),
        )
        assert (
            record["profile_url"]
            == "https://atlas.rebuildingus.org/profiles/organizations/helper-org-aaaa"
        )


class TestEntityFreshnessFallbackChain:
    def test_uses_last_confirmed_at_when_present(self) -> None:
        today = datetime.now(UTC).date().isoformat()
        entry = _build_entry(last_confirmed_at=f"{today}T12:00:00+00:00")
        info = data_module._entity_freshness(entry=entry, latest_source_date=None)  # noqa: SLF001
        assert info.staleness_status == "fresh"

    def test_uses_last_verified_when_no_last_confirmed(self) -> None:
        entry = _build_entry(
            last_verified=datetime.now(UTC).date() - timedelta(days=FRESHNESS_DAYS + 5)
        )
        info = data_module._entity_freshness(entry=entry, latest_source_date=None)  # noqa: SLF001
        assert info.staleness_status == "aging"

    def test_uses_latest_source_date_when_no_verification_metadata(self) -> None:
        entry = _build_entry()
        # Override last_seen to a stale value too, ensuring the latest_source_date wins.
        entry = replace(entry, last_seen=date(2020, 1, 1))
        info = data_module._entity_freshness(  # noqa: SLF001
            entry=entry, latest_source_date=datetime.now(UTC).date().isoformat()
        )
        assert info.staleness_status == "fresh"


class TestSourceFreshness:
    def test_published_date_fresh(self) -> None:
        info = data_module._source_freshness(  # noqa: SLF001
            {
                "published_date": datetime.now(UTC).date().isoformat(),
                "ingested_at": None,
                "created_at": None,
            }
        )
        assert info.staleness_status == "fresh"

    def test_falls_back_to_ingested(self) -> None:
        info = data_module._source_freshness(  # noqa: SLF001
            {
                "published_date": None,
                "ingested_at": datetime.now(UTC).date().isoformat(),
                "created_at": None,
            }
        )
        assert info.staleness_status == "fresh"

    def test_unknown_when_all_missing(self) -> None:
        info = data_module._source_freshness(  # noqa: SLF001
            {"published_date": None, "ingested_at": None, "created_at": None}
        )
        assert info.staleness_status == "unknown"


# ---------------------------------------------------------------------------
# DatabaseSession
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_database_session_opens_and_closes(db_url: str) -> None:
    """`DatabaseSession` must yield a connection and close it on exit."""
    async with DatabaseSession(db_url) as conn:
        cursor = await conn.execute("SELECT 1")
        row = await cursor.fetchone()
        assert row == (1,)


@pytest.mark.asyncio
async def test_database_session_aexit_without_aenter_is_safe(db_url: str) -> None:
    """`__aexit__` must tolerate the no-connection state (branch 736->exit)."""
    session = DatabaseSession(db_url)
    # Bypass __aenter__ entirely; __aexit__ should be a no-op when the
    # connection was never opened.
    await session.__aexit__(None, None, None)


def test_place_resource_slug_state_only_uses_short_path() -> None:
    """`_place_resource_slug` returns the state slug directly when city is absent."""
    assert (
        data_module._place_resource_slug({"city": None, "state": "IN", "region": None})  # noqa: SLF001
        == "in"
    )


# ---------------------------------------------------------------------------
# AtlasDataService - integration coverage against a populated DB
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_entities_returns_items_with_pagination(
    populated_service: AtlasDataService,
) -> None:
    """search_entities with `limit=1` should expose a next_cursor."""
    page = await populated_service.search_entities(place="Gary, IN", limit=1)
    assert page["total"] >= 2  # noqa: PLR2004
    assert len(page["items"]) == 1
    assert page["next_cursor"] == "1"
    assert page["place"]["display"] == "Gary, IN"


@pytest.mark.asyncio
async def test_search_entities_no_results_no_cursor(
    populated_service: AtlasDataService,
) -> None:
    """A query that matches nothing yields an empty page with no cursor."""
    page = await populated_service.search_entities(text="zzqqxxxnonsense")
    assert page["items"] == []
    assert page["next_cursor"] is None


@pytest.mark.asyncio
async def test_get_place_entities_alias_delegates_to_search(
    populated_service: AtlasDataService,
) -> None:
    """`get_place_entities` is a place-first alias for `search_entities`."""
    page = await populated_service.get_place_entities("Gary, IN")
    assert page["total"] >= 1


@pytest.mark.asyncio
async def test_get_place_entities_sorts_by_objective_actor_fields(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Place actor sorting should use stable fields already computed by Atlas."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    alphabetical_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Aardvark Civic League",
        description="Alphabetical coverage fixture.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    recent_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Zeta Recent Coalition",
        description="Recent coverage fixture.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    recent_source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/recent-zeta",
        source_type="report",
        extraction_method="manual",
        title="Recent Zeta report",
        publication="Example Journal",
        published_date=date.today() + timedelta(days=1),  # noqa: DTZ011
    )
    await SourceCRUD.link_to_entry(conn, recent_id, recent_source_id)
    await conn.commit()

    by_source_count = await populated_service.get_place_entities("Gary, IN", sort="source_count")
    by_recent = await populated_service.get_place_entities("Gary, IN", sort="recent")
    by_name = await populated_service.get_place_entities("Gary, IN", sort="name")

    assert by_source_count["items"][0]["name"] == "Atlas Primary Org"
    assert by_recent["items"][0]["name"] == "Zeta Recent Coalition"
    assert by_name["items"][0]["id"] == alphabetical_id


@pytest.mark.asyncio
async def test_get_place_entities_rejects_unknown_sort(
    populated_service: AtlasDataService,
) -> None:
    """Unknown place actor sort values should fail instead of falling back."""
    with pytest.raises(ValueError, match="Invalid entity sort"):
        await populated_service.get_place_entities("Gary, IN", sort="made_up")


@pytest.mark.asyncio
async def test_search_entities_profile_url_none_by_default(
    populated_service: AtlasDataService,
) -> None:
    """Without a configured public_url, search_entities leaves profile_url as None."""
    page = await populated_service.search_entities(place="Gary, IN", limit=1)
    assert page["items"][0]["profile_url"] is None


@pytest.mark.asyncio
async def test_search_entities_profile_url_when_public_url_configured(
    db_url: str,
    populated_service: AtlasDataService,  # noqa: ARG001
) -> None:
    """search_entities builds an absolute profile_url once the service has a public_url."""
    service = AtlasDataService(db_url, public_url="https://atlas.rebuildingus.org")
    page = await service.search_entities(place="Gary, IN", limit=1)
    assert page["items"][0]["profile_url"].startswith(
        "https://atlas.rebuildingus.org/profiles/organizations/"
    )


@pytest.mark.asyncio
async def test_get_entity_returns_detail_payload(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """`get_entity` should expand sources and relationship_ids."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    primary = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await primary.fetchone())[0]

    detail = await populated_service.get_entity(primary_id)
    assert detail["id"] == primary_id
    assert detail["sources"], "primary entity should have linked sources"
    assert any(rid.startswith("atlas://") for rid in detail["relationship_ids"])


@pytest.mark.asyncio
async def test_get_entity_excludes_suppressed_sources(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Suppressed source ids should be filtered out by default."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    cursor = await conn.execute(
        "SELECT source_id FROM entry_sources WHERE entry_id = ?", (primary_id,)
    )
    rows = await cursor.fetchall()
    assert rows
    suppressed = rows[0][0]
    await EntryCRUD.update(conn, primary_id, suppressed_source_ids=[suppressed])

    public_view = await populated_service.get_entity(primary_id)
    assert all(source["id"] != suppressed for source in public_view["sources"])
    assert suppressed not in public_view["source_ids"]

    admin_view = await populated_service.get_entity(primary_id, include_suppressed=True)
    assert any(source["id"] == suppressed for source in admin_view["sources"])


@pytest.mark.asyncio
async def test_get_entity_not_found_raises(populated_service: AtlasDataService) -> None:
    with pytest.raises(ValueError, match="Entity not found"):
        await populated_service.get_entity("does-not-exist")


@pytest.mark.asyncio
async def test_get_entity_profile_url_none_without_configured_public_url(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Without a configured public_url, get_entity leaves profile_url as None."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    detail = await populated_service.get_entity(primary_id)
    assert detail["profile_url"] is None


@pytest.mark.asyncio
async def test_get_entity_profile_url_when_public_url_configured(
    db_url: str,
    test_db: object,
    populated_service: AtlasDataService,  # noqa: ARG001
) -> None:
    """get_entity builds an absolute profile_url once the service has a public_url."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id, slug FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id, primary_slug = await cursor.fetchone()

    service = AtlasDataService(db_url, public_url="https://atlas.rebuildingus.org")
    detail = await service.get_entity(primary_id)
    assert (
        detail["profile_url"]
        == f"https://atlas.rebuildingus.org/profiles/organizations/{primary_slug}"
    )


@pytest.mark.asyncio
async def test_get_entity_sources_returns_payload(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_entity_sources(primary_id)
    assert payload["entity_id"] == primary_id
    assert payload["sources"]


@pytest.mark.asyncio
async def test_get_entity_sources_filters_suppressed(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    cursor = await conn.execute(
        "SELECT source_id FROM entry_sources WHERE entry_id = ?", (primary_id,)
    )
    suppressed = (await cursor.fetchone())[0]
    await EntryCRUD.update(conn, primary_id, suppressed_source_ids=[suppressed])

    public_view = await populated_service.get_entity_sources(primary_id)
    assert all(source["id"] != suppressed for source in public_view["sources"])

    admin_view = await populated_service.get_entity_sources(primary_id, include_suppressed=True)
    assert any(source["id"] == suppressed for source in admin_view["sources"])


@pytest.mark.asyncio
async def test_get_entity_sources_not_found_raises(
    populated_service: AtlasDataService,
) -> None:
    with pytest.raises(ValueError, match="Entity not found"):
        await populated_service.get_entity_sources("missing")


@pytest.mark.asyncio
async def test_get_entity_sources_respects_limit(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    payload = await populated_service.get_entity_sources(primary_id, limit=1)

    assert len(payload["sources"]) == 1
    assert payload["total"] == EXPECTED_TWO_CONTACT_SOURCES
    assert payload["next_cursor"] == "1"


@pytest.mark.asyncio
async def test_get_entity_sources_second_page_via_cursor(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    first_page = await populated_service.get_entity_sources(primary_id, limit=1)
    second_page = await populated_service.get_entity_sources(
        primary_id, limit=1, cursor=first_page["next_cursor"]
    )

    assert len(second_page["sources"]) == 1
    assert second_page["next_cursor"] is None
    assert first_page["sources"][0]["id"] != second_page["sources"][0]["id"]


@pytest.mark.asyncio
async def test_get_entity_sources_invalid_cursor_raises(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    with pytest.raises(ValueError, match="Invalid cursor"):
        await populated_service.get_entity_sources(primary_id, cursor="not-a-number")


@pytest.mark.asyncio
async def test_search_sources_applies_filters_and_text(
    populated_service: AtlasDataService,
) -> None:
    """Hit each filter clause: place, issue_areas, source_types, text."""
    payload = await populated_service.search_sources(
        place="Gary, IN",
        issue_areas=["housing_affordability"],
        source_types=["news_article", "report"],
        text="article",
        limit=1,
    )
    assert payload["items"]
    assert payload["next_cursor"] in {None, "1"}


@pytest.mark.asyncio
async def test_search_sources_region_filter_returns_empty_for_unknown(
    populated_service: AtlasDataService,
) -> None:
    """Region filter without matches still returns a structured empty page."""
    payload = await populated_service.search_sources(place={"region": "Nowhere"}, limit=10)
    assert payload["items"] == []
    assert payload["next_cursor"] is None


@pytest.mark.asyncio
async def test_search_sources_no_filters(populated_service: AtlasDataService) -> None:
    """No-filter call returns all sources (covers the `1 = 1` baseline)."""
    payload = await populated_service.search_sources()
    assert payload["total"] >= 1


@pytest.mark.asyncio
async def test_get_place_sources_alias(populated_service: AtlasDataService) -> None:
    payload = await populated_service.get_place_sources("Gary, IN")
    assert payload["total"] >= 1


@pytest.mark.asyncio
async def test_resolve_issue_areas_returns_ranked_matches(
    populated_service: AtlasDataService,
) -> None:
    """Free-text should rank into known issue area slugs."""
    payload = await populated_service.resolve_issue_areas(
        "We need affordable housing and tenant protections.", limit=3
    )
    assert payload["items"]
    assert payload["items"][0]["match_score"] is not None


@pytest.mark.asyncio
async def test_resolve_issue_areas_empty_when_no_match(
    populated_service: AtlasDataService,
) -> None:
    """Tokens with no overlap produce an empty list (skip branch)."""
    payload = await populated_service.resolve_issue_areas("zzqqxxxnonsense", limit=5)
    assert payload["items"] == []


@pytest.mark.asyncio
async def test_get_place_issue_signals_summarizes_entities(
    populated_service: AtlasDataService,
) -> None:
    payload = await populated_service.get_place_issue_signals("Gary, IN")
    assert payload["place"]["display"] == "Gary, IN"
    assert payload["issues"]
    assert payload["resource_uri"].startswith("atlas://cities/")


@pytest.mark.asyncio
async def test_get_place_issue_signals_filters_to_requested_issues(
    populated_service: AtlasDataService,
) -> None:
    """Issue filter should drop signals outside the requested set."""
    payload = await populated_service.get_place_issue_signals(
        "Gary, IN", issue_areas=["housing_affordability"]
    )
    slugs = [issue["issue_area_id"] for issue in payload["issues"]]
    assert slugs == ["housing_affordability"]


@pytest.mark.asyncio
async def test_get_place_issue_signals_scans_beyond_first_page(
    populated_service: AtlasDataService,
) -> None:
    """A place with more matches than one internal page must still be complete.

    The Gary, IN fixture has 2 entities. Shrinking the internal scan page size
    to 1 forces get_place_issue_signals to walk 2 pages; if it only read the
    first page, `worker_cooperatives` (on primary only) would still show up,
    but the counts for the shared `housing_affordability` issue would
    undercount the second entity.
    """
    with patch.object(data_module, "_EXHAUSTIVE_SCAN_PAGE_SIZE", 1):
        payload = await populated_service.get_place_issue_signals("Gary, IN")

    housing = next(
        issue for issue in payload["issues"] if issue["issue_area_id"] == "housing_affordability"
    )
    assert housing["entity_count"] == EXPECTED_TWO_RELATED_ENTITIES


@pytest.mark.asyncio
async def test_get_place_coverage_scans_beyond_first_page(
    populated_service: AtlasDataService,
) -> None:
    """Same exhaustive-scan guarantee, for the coverage summary."""
    with patch.object(data_module, "_EXHAUSTIVE_SCAN_PAGE_SIZE", 1):
        payload = await populated_service.get_place_coverage("Gary, IN")

    assert payload["entity_count"] == EXPECTED_TWO_RELATED_ENTITIES


@pytest.mark.asyncio
async def test_get_place_profile_returns_seed_data(
    populated_service: AtlasDataService,
) -> None:
    payload = await populated_service.get_place_profile("Gary, IN")
    assert payload["resource_uri"].startswith("atlas://cities/gary-in")
    assert payload["demographics"]["population"] > 0


@pytest.mark.asyncio
async def test_get_place_profile_not_found_raises(
    populated_service: AtlasDataService,
) -> None:
    with pytest.raises(ValueError, match="Place profile not found"):
        await populated_service.get_place_profile("Nowhere, ZZ")


@pytest.mark.asyncio
async def test_get_place_coverage_summary(
    populated_service: AtlasDataService,
) -> None:
    payload = await populated_service.get_place_coverage("Gary, IN")
    assert payload["entity_count"] >= 1
    assert "housing_affordability" in payload["covered_issue_area_ids"]
    # `worker_cooperatives` is on a single entity so it lands in the thin set.
    assert "worker_cooperatives" in payload["thin_issue_area_ids"]
    assert payload["uncovered_domains"]


@pytest.mark.asyncio
async def test_get_place_coverage_with_explicit_issue_filter(
    populated_service: AtlasDataService,
) -> None:
    """Issue filter narrows the universe of issues considered."""
    payload = await populated_service.get_place_coverage(
        "Gary, IN", issue_areas=["housing_affordability"]
    )
    expected = ["housing_affordability"]
    issues = [count["issue_area_id"] for count in payload["issue_counts"]]
    assert issues == expected


@pytest.mark.asyncio
async def test_get_related_entities_includes_all_relationship_types(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """All five relationship branches must surface for the seeded fixture."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    payload = await populated_service.get_related_entities(primary_id)
    assert payload["entity_id"] == primary_id
    assert payload["items"], "primary should have at least one related entity"
    relationships = payload["items"][0]["relationships"]
    types = {relationship["type"] for relationship in relationships}
    assert {"affiliated_member", "shared_issue_area", "shared_place", "shared_source"} <= types
    assert payload["items"][0]["entity"]["profile_url"] is None


@pytest.mark.asyncio
async def test_get_related_entities_profile_url_when_public_url_configured(
    db_url: str,
    test_db: object,
    populated_service: AtlasDataService,  # noqa: ARG001
) -> None:
    """get_related_entities threads public_url through to nested entity records."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    service = AtlasDataService(db_url, public_url="https://atlas.rebuildingus.org")
    payload = await service.get_related_entities(primary_id)
    assert payload["items"][0]["entity"]["profile_url"].startswith(
        "https://atlas.rebuildingus.org/profiles/organizations/"
    )


@pytest.mark.asyncio
async def test_get_related_entities_reverse_affiliated_organization(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """The reverse direction (looking up the affiliated child) emits affiliated_organization."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Related Org'")
    related_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_related_entities(related_id)
    types: set[str] = set()
    for item in payload["items"]:
        for relationship in item["relationships"]:
            types.add(relationship["type"])
    assert "affiliated_organization" in types


@pytest.mark.asyncio
async def test_get_related_entities_relation_filter_drops_non_matches(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """The relation_types filter only keeps requested kinds."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_related_entities(
        primary_id, relation_types=["affiliated_member"]
    )
    for item in payload["items"]:
        for relationship in item["relationships"]:
            assert relationship["type"] == "affiliated_member"


@pytest.mark.asyncio
async def test_get_related_entities_filter_can_yield_empty(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Filtering to a relation type the entity lacks yields no items."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_related_entities(
        primary_id, relation_types=["affiliated_organization"]
    )
    assert payload["items"] == []


@pytest.mark.asyncio
async def test_get_related_entities_partial_relationship_branches(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Cover the False branches for shared_issue_area and shared_source.

    Add a sibling entry in the same city (so `search_public(cities=[entry.city])`
    still returns it) but with no shared issue areas and no shared sources. The
    `affiliated_member` link keeps the entry in the result so the optional
    `shared_issue_area`/`shared_source` branches can take their False paths.
    """
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    sibling_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Sibling Org",
        description="Same place, no shared issues or sources, but affiliated.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=primary_id,
    )

    payload = await populated_service.get_related_entities(primary_id)
    by_id = {item["entity"]["id"]: item for item in payload["items"]}
    assert sibling_id in by_id
    types = {rel["type"] for rel in by_id[sibling_id]["relationships"]}
    # `affiliated_member` keeps the entity in the response, plus shared_place.
    assert "affiliated_member" in types
    assert "shared_place" in types
    # The other optional branches must NOT fire because the shared sets are empty.
    assert "shared_issue_area" not in types
    assert "shared_source" not in types


@pytest.mark.asyncio
async def test_get_related_entities_respects_limit_and_cursor(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """A second affiliated sibling gives primary_id two related items to page over."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Second Sibling Org",
        description="Another affiliated sibling so there are two related items.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=primary_id,
    )

    first_page = await populated_service.get_related_entities(primary_id, limit=1)
    assert len(first_page["items"]) == 1
    assert first_page["total"] == EXPECTED_TWO_RELATED_ENTITIES
    assert first_page["next_cursor"] == "1"

    second_page = await populated_service.get_related_entities(
        primary_id, limit=1, cursor=first_page["next_cursor"]
    )
    assert len(second_page["items"]) == 1
    assert second_page["next_cursor"] is None
    assert first_page["items"][0]["entity"]["id"] != second_page["items"][0]["entity"]["id"]


@pytest.mark.asyncio
async def test_get_related_entities_invalid_cursor_raises(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    with pytest.raises(ValueError, match="Invalid cursor"):
        await populated_service.get_related_entities(primary_id, cursor="not-a-number")


@pytest.mark.asyncio
async def test_get_related_entities_falsy_same_place_branch(db_url: str, test_db: object) -> None:
    """When the entity has no city, `same_place` evaluates False even with state match.

    Covers the False branch of `if same_place:` (640->643) without requiring
    cross-place search filtering.
    """
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    placeless_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Placeless Primary",
        description="Has a state but no city.",
        city=None,
        state="IN",
        geo_specificity="statewide",
    )
    other_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Other In-State",
        description="Same state, different city.",
        city="Indianapolis",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=placeless_id,
    )

    service = AtlasDataService(db_url)
    payload = await service.get_related_entities(placeless_id)
    types: set[str] = set()
    for item in payload["items"]:
        if item["entity"]["id"] == other_id:
            types = {rel["type"] for rel in item["relationships"]}
    # `same_place` short-circuits to False because the primary entry has no city.
    assert "shared_place" not in types
    # The affiliated_member relationship still keeps the entity in the response.
    assert "affiliated_member" in types


@pytest.mark.asyncio
async def test_get_related_entities_isolated_entry_yields_empty(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """An entry with no shared place, issues, or sources returns no relationships."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    isolated_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Isolated Org",
        description="Has no neighbors.",
        city="Boise",
        state="ID",
        geo_specificity="local",
    )
    payload = await populated_service.get_related_entities(isolated_id)
    assert payload["items"] == []


@pytest.mark.asyncio
async def test_get_related_entities_not_found_raises(
    populated_service: AtlasDataService,
) -> None:
    with pytest.raises(ValueError, match="Entity not found"):
        await populated_service.get_related_entities("missing")


@pytest.mark.asyncio
async def test_create_entity_flag_persists_record(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    flag = await populated_service.create_entity_flag(primary_id, reason="duplicate", note="dup")
    assert flag["entity_id"] == primary_id
    assert flag["reason"] == "duplicate"
    assert flag["status"] == "open"


@pytest.mark.asyncio
async def test_create_source_flag_persists_record(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    cursor = await conn.execute("SELECT id FROM sources LIMIT 1")
    source_id = (await cursor.fetchone())[0]
    flag = await populated_service.create_source_flag(source_id, reason="incorrect", note=None)
    assert flag["source_id"] == source_id
    assert flag["status"] == "open"


# ---------------------------------------------------------------------------
# Branch coverage for the no-cursor-at-end and source no-cursor paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_sources_under_limit_no_cursor(
    populated_service: AtlasDataService,
) -> None:
    """When fewer rows come back than `limit`, next_cursor stays None."""
    payload = await populated_service.search_sources(limit=100)
    assert payload["next_cursor"] is None


# ---------------------------------------------------------------------------
# Honest trust signals (corroboration tier + attribute grounding)
# ---------------------------------------------------------------------------


class TestTrustLevel:
    """`_trust_level` reflects honest corroboration tiers and never overclaims."""

    def test_subject_verified_outranks_everything(self) -> None:
        entry = _build_entry(claim_status="verified", verified=True)
        level = data_module._trust_level(entry=entry, independent_source_count=5)  # noqa: SLF001
        assert level == "subject_verified"

    def test_atlas_verified_when_verified_flag_set(self) -> None:
        entry = _build_entry(verified=True)
        assert data_module._trust_level(entry=entry, independent_source_count=1) == "atlas_verified"  # noqa: SLF001

    def test_corroborated_with_two_independent_sources(self) -> None:
        entry = _build_entry()
        assert data_module._trust_level(entry=entry, independent_source_count=2) == "corroborated"  # noqa: SLF001

    def test_unverified_with_single_source(self) -> None:
        entry = _build_entry()
        assert data_module._trust_level(entry=entry, independent_source_count=1) == "unverified"  # noqa: SLF001

    def test_unverified_when_independent_count_unknown(self) -> None:
        entry = _build_entry()
        assert data_module._trust_level(entry=entry, independent_source_count=None) == "unverified"  # noqa: SLF001


class TestTrustInputsFromSources:
    """`_trust_inputs_from_sources` counts distinct domains and grounds contact."""

    def test_counts_distinct_registrable_domains(self) -> None:
        entry = _build_entry()
        sources = [
            {"url": "https://www.kcur.org/a", "extraction_context": ""},
            {"url": "https://kcur.org/b", "extraction_context": ""},
            {"url": "https://kansascity.com/c", "extraction_context": ""},
        ]
        result = data_module._trust_inputs_from_sources(entry, sources)  # noqa: SLF001
        count, website_grounded, email_grounded = result
        assert count == EXPECTED_DISTINCT_DOMAINS
        assert website_grounded is False
        assert email_grounded is False

    def test_website_grounded_when_source_shares_domain(self) -> None:
        entry = replace(_build_entry(), website="https://prairie.org")
        sources = [{"url": "https://prairie.org/about", "extraction_context": "About us"}]
        _, website_grounded, _ = data_module._trust_inputs_from_sources(entry, sources)  # noqa: SLF001
        assert website_grounded is True

    def test_website_grounded_when_host_quoted_in_context(self) -> None:
        entry = replace(_build_entry(), website="https://prairie.org")
        sources = [{"url": "https://kcur.org/x", "extraction_context": "see prairie.org for more"}]
        _, website_grounded, _ = data_module._trust_inputs_from_sources(entry, sources)  # noqa: SLF001
        assert website_grounded is True

    def test_email_grounded_when_present_in_context_case_insensitive(self) -> None:
        entry = replace(_build_entry(), email="Hi@Prairie.org")
        sources = [
            {"url": "https://kcur.org/x", "extraction_context": "Reach hi@prairie.org today"}
        ]
        _, _, email_grounded = data_module._trust_inputs_from_sources(entry, sources)  # noqa: SLF001
        assert email_grounded is True

    def test_ungrounded_when_no_source_supports_contact(self) -> None:
        entry = replace(_build_entry(), website="https://prairie.org", email="hi@prairie.org")
        sources = [{"url": "https://kcur.org/x", "extraction_context": "no contact here"}]
        result = data_module._trust_inputs_from_sources(entry, sources)  # noqa: SLF001
        count, website_grounded, email_grounded = result
        assert count == 1
        assert website_grounded is False
        assert email_grounded is False

    def test_handles_missing_and_malformed_urls(self) -> None:
        entry = _build_entry()
        sources = [
            {"url": "", "extraction_context": ""},
            {"url": "not a url", "extraction_context": ""},
            {"url": "https:///no-host", "extraction_context": ""},
            {"extraction_context": "no url key"},
        ]
        count, _, _ = data_module._trust_inputs_from_sources(entry, sources)  # noqa: SLF001
        assert count == 0


class TestEntityRecordTrustBlock:
    """`_entity_record` surfaces the trust block built from context inputs."""

    def test_includes_trust_block(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=1,
                latest_source_date=None,
                independent_source_count=1,
                website_grounded=False,
                email_grounded=True,
            ),
        )
        assert record["trust"] == {
            "level": "unverified",
            "independent_source_count": 1,
            "website_grounded": False,
            "email_grounded": True,
        }

    def test_trust_defaults_when_inputs_absent(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
            ),
        )
        assert record["trust"]["level"] == "unverified"
        assert record["trust"]["independent_source_count"] is None


class TestEntityRecordActorQuality:
    """`_entity_record` exposes whether the record is a specific local actor."""

    def test_specific_actor_quality_is_complete_for_source_backed_local_org(self) -> None:
        entry = replace(
            _build_entry(),
            description="Runs weekly tenant legal clinics.",
            city="Kansas City",
            state="MO",
        )
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=["housing_affordability"],
                source_types=["news_article"],
                source_count=2,
                latest_source_date="2026-04-15",
            ),
        )

        assert record["actor_quality"] == {
            "level": "specific_actor",
            "score": 5,
            "total": 5,
            "present": ["actor", "work", "place", "issues", "sources"],
            "missing": [],
        }

    def test_actor_quality_names_missing_specificity_fields(self) -> None:
        entry = replace(
            _build_entry(entry_id="entry-thin"),
            type="campaign",
            description="",
            city=None,
            state=None,
            region=None,
            full_address=None,
            geo_specificity="national",
        )
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
            ),
        )

        assert record["actor_quality"]["level"] == "thin_record"
        assert record["actor_quality"]["present"] == []
        assert record["actor_quality"]["missing"] == ["actor", "work", "place", "issues", "sources"]


class TestEntityRecordClaimEvidence:
    """`_entity_record` explains visible profile claims with evidence metadata."""

    def test_includes_claim_evidence_for_visible_profile_facts(self) -> None:
        entry = replace(
            _build_entry(),
            website="https://helper.example",
            email="info@helper.example",
        )
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=["housing_affordability"],
                source_types=["news_article", "report"],
                source_count=3,
                source_ids=["source-1", "source-2", "source-3"],
                contact_source_ids=["source-1"],
                latest_source_date="2026-04-15",
                independent_source_count=2,
                website_grounded=True,
                email_grounded=False,
            ),
        )

        assert record["claim_evidence"]["summary"] == {
            "source_count": 3,
            "source_ids": ["source-1", "source-2", "source-3"],
            "confidence": "corroborated",
            "as_of": "2026-04-15",
            "verification_level": "source-derived",
        }
        assert record["claim_evidence"]["place"]["source_count"] == EXPECTED_THREE_SOURCES
        assert record["claim_evidence"]["issues"]["source_count"] == EXPECTED_THREE_SOURCES
        assert record["claim_evidence"]["contact"] == {
            "source_count": 1,
            "source_ids": ["source-1"],
            "confidence": "partial",
            "as_of": "2026-04-15",
            "verification_level": "source-derived",
        }

    def test_claim_evidence_marks_subject_verified_claims(self) -> None:
        entry = _build_entry(claim_status="verified", claimed_by_user_id="user-1")
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=["housing_affordability"],
                source_types=["news_article"],
                source_count=1,
                latest_source_date="2026-04-15",
                independent_source_count=1,
            ),
        )

        assert record["claim_evidence"]["summary"]["confidence"] == "subject_verified"
        assert record["claim_evidence"]["summary"]["verification_level"] == "subject-verified"

    def test_claim_evidence_marks_single_source_claims_unverified(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=["housing_affordability"],
                source_types=["news_article"],
                source_count=1,
                latest_source_date="2026-04-15",
                independent_source_count=1,
            ),
        )

        assert record["claim_evidence"]["summary"]["confidence"] == "unverified"

    def test_claim_evidence_marks_fully_grounded_contact(self) -> None:
        entry = replace(
            _build_entry(verified=True),
            website="https://helper.example",
            email="info@helper.example",
        )
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=["news_article"],
                source_count=2,
                contact_source_ids=["source-1", "source-2"],
                latest_source_date="2026-04-15",
                independent_source_count=1,
                website_grounded=True,
                email_grounded=True,
            ),
        )

        assert record["claim_evidence"]["contact"]["source_count"] == EXPECTED_TWO_CONTACT_SOURCES
        assert record["claim_evidence"]["contact"]["source_ids"] == ["source-1", "source-2"]
        assert record["claim_evidence"]["contact"]["confidence"] == "atlas_verified"

    def test_claim_evidence_marks_ungrounded_contact_unverified(self) -> None:
        entry = replace(_build_entry(), website="https://helper.example")
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=["news_article"],
                source_count=2,
                latest_source_date="2026-04-15",
                independent_source_count=2,
                website_grounded=False,
                email_grounded=False,
            ),
        )

        assert record["claim_evidence"]["contact"]["source_count"] == 0
        assert record["claim_evidence"]["contact"]["confidence"] == "unverified"

    def test_claim_evidence_marks_missing_contact_unverified(self) -> None:
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=[],
                source_types=[],
                source_count=0,
                latest_source_date=None,
            ),
        )

        assert record["claim_evidence"]["contact"]["confidence"] == "unverified"


class TestEntityRecordProfileAnswers:
    """`_entity_record` exposes scan-friendly profile answers for agent clients."""

    def test_includes_profile_answers_for_actor_records(self) -> None:
        entry = replace(
            _build_entry(),
            description="Organizes tenant legal clinics.",
            city="Kansas City",
            state="MO",
        )
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            EntityRecordContext(
                issue_area_ids=["housing_affordability"],
                source_types=["news_article", "report"],
                source_count=4,
                source_ids=["source-1", "source-2", "source-3", "source-4"],
                latest_source_date="2026-04-15",
                independent_source_count=3,
            ),
        )

        assert record["profile_answers"] == {
            "who": "Organization",
            "what_they_do": "Organizes tenant legal clinics.",
            "where": "Kansas City, MO",
            "why_they_matter": "4 sources · Housing Affordability",
            "how_atlas_knows": "4 sources · corroborated · Apr 2026",
        }
