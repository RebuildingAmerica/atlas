"""Trust-signal coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

from dataclasses import replace
from datetime import date

from datetime import UTC, datetime

import pytest

from atlas.platform.mcp import data as data_module

from tests.platform.mcp_data_support import (
    EXPECTED_DISTINCT_DOMAINS,
    EXPECTED_THREE_SOURCES,
    EXPECTED_TWO_CONTACT_SOURCES,
    _build_entry,
)


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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
                issue_area_ids=["housing_affordability"],
                source_types=["news_article"],
                source_count=1,
                latest_source_date="2026-04-15",
                independent_source_count=1,
            ),
        )

        assert record["claim_evidence"]["summary"]["confidence"] == "unverified"

    def test_claim_evidence_accepts_postgres_date_latest_source_date(self) -> None:
        """Postgres aggregate dates should serialize into public claim evidence."""
        entry = _build_entry()
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            data_module.EntityRecordContext(
                issue_area_ids=["mental_health_crisis_and_access"],
                source_types=["news_article"],
                source_count=1,
                latest_source_date=date(2026, 1, 14),
                independent_source_count=1,
            ),
        )

        assert record["claim_evidence"]["summary"]["as_of"] == "2026-01-14"

    def test_claim_evidence_marks_fully_grounded_contact(self) -> None:
        entry = replace(
            _build_entry(verified=True),
            website="https://helper.example",
            email="info@helper.example",
        )
        record = data_module._entity_record(  # noqa: SLF001
            entry,
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
            data_module.EntityRecordContext(
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
