"""Entity-record branch coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import FRESHNESS_DAYS, EntityRecordContext

from tests.platform.mcp_data_support import _build_entry


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
