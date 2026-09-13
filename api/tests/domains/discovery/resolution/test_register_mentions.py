"""Register rows and IRS returns turned into typed mentions."""

from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING

import pytest
from atlas_discovery_engine import (
    FilingOfficer,
    FilingPosition,
    NameField,
    OrganizationFiling,
    RegistryOrganization,
)

from atlas.domains.discovery.resolution.register_mentions import (
    CURRENT_ROLE_WINDOW,
    display_name,
    organization_mention,
    person_mentions,
)

if TYPE_CHECKING:
    from atlas.domains.discovery.resolution.mentions import PersonMention

TODAY = date(2026, 9, 13)
RECENT = date(2025, 6, 30)


def _organization(**overrides: object) -> RegistryOrganization:
    fields: dict[str, object] = {
        "name": "Lincoln Food Bank",
        "city": "Lincoln",
        "state": "NE",
        "registry_id": "470123456",
        "source_url": "https://projects.propublica.org/nonprofits/organizations/470123456",
        "category_code": "K31",
        "website": "https://lincolnfood.org",
    }
    fields.update(overrides)
    return RegistryOrganization(**fields)  # type: ignore[arg-type]


def _people(
    *officers: FilingOfficer, return_type: str | None = "990", period: date | None = RECENT
) -> list[PersonMention]:
    organization = organization_mention(_organization())
    assert organization is not None
    filing = OrganizationFiling(
        "470123456", "202610729349300100", officers, return_type, tax_period_end=period
    )
    return person_mentions(organization, filing, today=TODAY)


class TestOrganizationMention:
    def test_states_what_the_register_asserts(self) -> None:
        mention = organization_mention(_organization())

        assert mention is not None
        assert mention.ein == "470123456"
        assert mention.context == (
            "Registered nonprofit filing IRS Form 990 under EIN 470123456, "
            "based in Lincoln, NE, classified K31."
        )
        assert str(mention.source.source_type) == "government_record"

    def test_omits_what_the_register_did_not_publish(self) -> None:
        mention = organization_mention(_organization(city=None, state=None, category_code=None))

        assert mention is not None
        assert mention.context == "Registered nonprofit filing IRS Form 990 under EIN 470123456."

    def test_a_nameless_row_is_no_mention(self) -> None:
        assert organization_mention(_organization(name="")) is None


class TestPersonMentions:
    def test_a_business_row_names_no_person(self) -> None:
        people = _people(
            FilingOfficer("Acme Trust Company", "Trustee", NameField.BUSINESS),
            FilingOfficer("Ana Ortiz", "Chair", positions=frozenset({FilingPosition.OFFICER})),
        )

        [ana] = people
        assert ana.type_conflict is False
        assert ana.role.relationship_type == "officer"
        assert ana.role.current is True
        assert ana.role.observed_on == RECENT
        assert ana.role.evidence_label == "Chair, Form 990 for the period ending June 2025"
        assert ana.context == (
            "Listed as Chair of Lincoln Food Bank on its IRS Form 990 "
            "for the period ending June 2025."
        )

    @pytest.mark.parametrize(
        "officer",
        [
            FilingOfficer(
                "JAMIE CLARK",
                "Trustee",
                positions=frozenset({FilingPosition.INSTITUTIONAL_TRUSTEE}),
            ),
            FilingOfficer("BANK OF AMERICA N A", "Trustee"),
            FilingOfficer("Sarah Stone until fall 2024", "Director"),
            FilingOfficer("SAN JUANITA TAYLOR", "Director"),
        ],
        ids=["institutional box", "bank name", "annotated name", "unparseable name"],
    )
    def test_flags_a_row_that_may_not_name_a_person(self, officer: FilingOfficer) -> None:
        [mention] = _people(officer)

        assert mention.type_conflict is True

    @pytest.mark.parametrize(
        ("positions", "relationship_type"),
        [
            ({FilingPosition.TRUSTEE_OR_DIRECTOR}, "board_member"),
            ({FilingPosition.KEY_EMPLOYEE}, "staff"),
            ({FilingPosition.HIGHEST_COMPENSATED}, "staff"),
            (set(), "officer_or_director"),
        ],
    )
    def test_types_the_role_from_the_checked_boxes(
        self, positions: set[FilingPosition], relationship_type: str
    ) -> None:
        [mention] = _people(FilingOfficer("Ana Ortiz", "Chair", positions=frozenset(positions)))

        assert mention.role.relationship_type == relationship_type

    def test_a_role_the_return_says_ended_is_not_current(self) -> None:
        [mention] = _people(FilingOfficer("Ben Lee", "Former Treasurer"))

        assert mention.role.current is False

    def test_a_role_on_a_stale_return_is_not_current(self) -> None:
        stale = TODAY - CURRENT_ROLE_WINDOW - timedelta(days=1)
        [mention] = _people(FilingOfficer("Ana Ortiz", "Chair"), period=stale)

        assert mention.role.current is False

    def test_an_undated_untitled_row_invents_nothing(self) -> None:
        [mention] = _people(FilingOfficer("Eli Park", None), return_type=None, period=None)

        assert mention.role.current is False
        assert mention.role.observed_on is None
        assert mention.role.evidence_label == "Listed officer, director or trustee"
        assert mention.context == (
            "Listed as an officer, director or trustee of Lincoln Food Bank on its IRS Form 990."
        )

    def test_spells_the_form_the_way_the_irs_names_it(self) -> None:
        [mention] = _people(FilingOfficer("Ana Ortiz", "Trustee"), return_type="990PF")

        assert "Form 990-PF" in mention.context
        assert "Form 990-PF return" in mention.source.title


class TestDisplayName:
    @pytest.mark.parametrize(
        ("raw", "shown"),
        [
            ("MARY MCDONALD", "Mary McDonald"),
            ("ORTIZ, ANA", "Ana Ortiz"),
            ("DeShawn Lee", "DeShawn Lee"),
            ("", ""),
        ],
    )
    def test_cases_a_shouted_name_and_leaves_deliberate_case(self, raw: str, shown: str) -> None:
        assert display_name(raw) == shown
