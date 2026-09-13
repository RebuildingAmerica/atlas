"""Resolved mentions stored as entries, EIN keys, dated roles and holds."""

from __future__ import annotations

from datetime import date

import pytest
from atlas_discovery_engine import FilingOfficer, OrganizationFiling, RegistryOrganization
from atlas_shared import SourceType

from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.discovery.resolution.mentions import OrganizationMention, PersonMention
from atlas.domains.discovery.resolution.persist import (
    ResolutionSummary,
    persist_resolved_mentions,
)
from atlas.domains.discovery.resolution.register_mentions import (
    organization_mention,
    person_mentions,
)
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD, SourceCRUD

TODAY = date(2026, 9, 13)
ORG_URL = "https://projects.propublica.org/nonprofits/organizations"


def _organization(ein: str = "470123456", name: str = "Lincoln Food Bank") -> OrganizationMention:
    mention = organization_mention(
        RegistryOrganization(
            name=name, city="Lincoln", state="NE", registry_id=ein, source_url=f"{ORG_URL}/{ein}"
        )
    )
    assert mention is not None
    return mention


def _person(
    organization: OrganizationMention,
    name: str = "ANA ORTIZ",
    *,
    title: str = "Chair",
    period: date | None = date(2025, 6, 30),
) -> PersonMention:
    filing = OrganizationFiling(
        organization.ein, f"2026{organization.ein}", (FilingOfficer(name, title),), "990", period
    )
    [mention] = person_mentions(organization, filing, today=TODAY)
    return mention


async def _persist(
    conn: object, organizations: list[OrganizationMention], people: list[PersonMention]
) -> ResolutionSummary:
    return await persist_resolved_mentions(
        conn,  # type: ignore[arg-type]
        organizations=organizations,
        people=people,
        issue_areas=["food_security"],
        today=TODAY,
    )


async def _pending(conn: object) -> list[tuple[str | None, str]]:
    return [(i.entity_id, i.hold_reason) for i in await ReviewQueueCRUD.list_pending(conn)]


@pytest.mark.asyncio
async def test_publishes_an_organization_and_its_officer_linked_by_a_dated_role(
    test_db: object,
) -> None:
    organization = _organization()
    person = _person(organization)

    summary = await _persist(test_db, [organization], [person])

    org_id, person_id = summary.entry_ids
    assert (summary.published, summary.held) == (2, {})
    stored_person = await EntryCRUD.get_by_id(test_db, person_id)
    assert stored_person is not None
    assert (stored_person.name, stored_person.active) == ("Ana Ortiz", True)
    key = await RelationshipCRUD.get_identity_key(test_db, key_type="ein", key_value="47-0123456")
    assert key is not None
    assert key.entry_id == org_id
    [edge] = await RelationshipCRUD.list_edges_for_entry(test_db, person_id)
    assert (edge.source_entry_id, edge.target_entry_id) == (person_id, org_id)
    assert edge.relationship_type == "officer_or_director"
    assert edge.first_seen.startswith("2025-06-30")
    assert edge.last_seen.startswith("2025-06-30")
    source = await SourceCRUD.get_by_url(test_db, person.source.url)
    assert source is not None
    assert source.type == "government_record"


@pytest.mark.asyncio
async def test_running_again_resolves_to_the_same_records(test_db: object) -> None:
    organization = _organization()
    person = _person(organization)
    first = await _persist(test_db, [organization], [person])

    second = await _persist(test_db, [organization], [person])

    assert second.entry_ids == first.entry_ids
    [edge] = await RelationshipCRUD.list_edges_for_entry(test_db, first.entry_ids[1])
    assert edge.evidence_count == 2  # noqa: PLR2004


@pytest.mark.asyncio
async def test_an_organization_found_on_the_web_first_gains_its_ein_and_publishes(
    test_db: object,
) -> None:
    """A web record with the same name and place is the same filer, and keeps its words."""
    web_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Lincoln Food Bank",
        description="Feeds 4,000 families a week.",
        city="Lincoln",
        state="NE",
        geo_specificity="local",
        active=False,
    )

    summary = await _persist(test_db, [_organization()], [])

    assert summary.entry_ids == [web_id]
    stored = await EntryCRUD.get_by_id(test_db, web_id)
    assert stored is not None
    assert (stored.active, stored.description) == (True, "Feeds 4,000 families a week.")


@pytest.mark.asyncio
async def test_a_pending_duplicate_review_keeps_a_matched_organization_held(
    test_db: object,
) -> None:
    """Merging is a reviewer's call, so the register's EIN does not settle it."""
    web_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Lincoln Food Bank",
        description="Feeds families.",
        city="Lincoln",
        state="NE",
        geo_specificity="local",
        active=False,
    )
    await ReviewQueueCRUD.enqueue(
        test_db,
        entity_id=web_id,
        kind="organization",
        hold_reason="dedup_suspect",
        score=None,
        dedup_suspect=True,
        dedup_note=None,
    )

    summary = await _persist(test_db, [_organization()], [])

    assert (summary.entry_ids, summary.published) == ([web_id], 0)
    stored = await EntryCRUD.get_by_id(test_db, web_id)
    assert stored is not None
    assert stored.active is False


@pytest.mark.asyncio
async def test_a_same_named_organization_with_another_ein_is_a_different_filer(
    test_db: object,
) -> None:
    first = await _persist(test_db, [_organization("111111111")], [])

    second = await _persist(test_db, [_organization("222222222")], [])

    assert first.entry_ids != second.entry_ids


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("name", "title", "period", "reason"),
    [
        ("BANK OF AMERICA N A", "Trustee", date(2025, 6, 30), "type_conflict"),
        ("Ana Ortiz", "Former Chair", date(2025, 6, 30), "no_current_role"),
        ("Ana Ortiz", "Chair", None, "no_current_role"),
    ],
)
async def test_holds_a_person_resolution_cannot_vouch_for(
    test_db: object, name: str, title: str, period: date | None, reason: str
) -> None:
    organization = _organization()

    summary = await _persist(
        test_db, [organization], [_person(organization, name, title=title, period=period)]
    )

    person_id = summary.entry_ids[1]
    stored = await EntryCRUD.get_by_id(test_db, person_id)
    assert stored is not None
    assert stored.active is False
    assert summary.held == {reason: 1}
    assert await _pending(test_db) == [(person_id, reason)]
    # The role is still recorded, so the person is found again next run.
    assert len(await RelationshipCRUD.list_edges_for_entry(test_db, person_id)) == 1


@pytest.mark.asyncio
async def test_one_name_at_two_organizations_is_two_people_and_a_review(
    test_db: object,
) -> None:
    food_bank = _organization("111111111", "Lincoln Food Bank")
    shelter = _organization("222222222", "Lincoln Shelter")
    first = await _persist(test_db, [food_bank], [_person(food_bank)])

    second = await _persist(test_db, [shelter], [_person(shelter)])

    assert first.entry_ids[1] != second.entry_ids[1]
    assert second.held == {"identity_ambiguous": 1}
    kept = await EntryCRUD.get_by_id(test_db, first.entry_ids[1])
    assert kept is not None
    assert kept.active is True


@pytest.mark.asyncio
async def test_a_hold_on_a_public_person_queues_review_without_unpublishing(
    test_db: object,
) -> None:
    organization = _organization()
    published = await _persist(test_db, [organization], [_person(organization)])

    later = _person(organization, title="Former Chair")
    await _persist(test_db, [organization], [later])

    person_id = published.entry_ids[1]
    stored = await EntryCRUD.get_by_id(test_db, person_id)
    assert stored is not None
    assert stored.active is True
    assert stored.description == later.context
    assert await _pending(test_db) == [(person_id, "no_current_role")]


@pytest.mark.asyncio
async def test_a_person_stored_before_roles_existed_is_found_through_their_return(
    test_db: object,
) -> None:
    """The 1,469 people held on 2026-09-13 cite a return but hold no relationship."""
    organization = _organization()
    person = _person(organization)
    legacy_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="ANA ORTIZ",
        description="Listed as Chair of Lincoln Food Bank on its IRS Form 990.",
        city="Lincoln",
        state="NE",
        geo_specificity="local",
        active=False,
    )
    source_id = await SourceCRUD.create(
        test_db,
        url=person.source.url,
        source_type=str(SourceType.GOVERNMENT_RECORD),
        extraction_method="autodiscovery",
    )
    await SourceCRUD.link_to_entry(test_db, legacy_id, source_id)

    summary = await _persist(test_db, [organization], [person])

    assert summary.entry_ids[1] == legacy_id
    stored = await EntryCRUD.get_by_id(test_db, legacy_id)
    assert stored is not None
    assert (stored.name, stored.active) == ("Ana Ortiz", True)


@pytest.mark.asyncio
async def test_a_person_from_a_web_page_elsewhere_in_the_state_makes_a_name_ambiguous(
    test_db: object,
) -> None:
    await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Ana Ortiz",
        description="Quoted in a news story.",
        city="Omaha",
        state="NE",
        geo_specificity="local",
        active=False,
    )
    organization = _organization()
    person = _person(organization)

    summary = await _persist(test_db, [organization], [person])

    assert summary.held == {"identity_ambiguous": 1}
