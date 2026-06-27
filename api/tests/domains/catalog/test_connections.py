"""Tests for the ranked, scored connection network."""

from types import SimpleNamespace
from typing import Any, cast

import pytest

from atlas.domains.catalog.models.connections import (
    _pluralize,
    _snippet,
    _tier_for_strength,
    compute_connections,
)
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.models.database import db as database

STATUS_OK = 200
SHARED_COUNT = 2  # two shared sources or issue areas
SCORE_CO_MENTION = 2.0  # one shared source
SCORE_TWO_SOURCES = 4.0  # two shared sources
SCORE_BOOSTED = 2.5  # one co-mention plus the same-city boost
SCORE_SOURCED_EDGE = 6.0  # explicit source-backed relationship edge
STRENGTH_FULL = 100
STRENGTH_WEAK = 40  # 2.0 / 5.0 normalized to 100
EXPECTED_TOTAL = 4  # an org plus three coworkers
PAGE_SIZE = 2
MIN_TOTAL = 2


async def _make_person(
    conn: Any,
    name: str,
    *,
    city: str | None = None,
    state: str | None = None,
    org_id: str | None = None,
) -> str:
    return await EntryCRUD.create(
        conn,
        entry_type="person",
        name=name,
        description=f"{name} bio",
        city=city,
        state=state,
        geo_specificity="local",
        affiliated_org_id=org_id,
    )


async def _make_org(conn: Any, name: str) -> str:
    return await EntryCRUD.create(
        conn,
        entry_type="organization",
        name=name,
        description=f"{name} description",
        city=None,
        state=None,
        geo_specificity="regional",
    )


async def _co_mention(conn: Any, entry_ids: list[str], *, publication: str | None) -> str:
    source_id = database.generate_uuid()
    await conn.execute(
        "INSERT INTO sources (id, url, title, publication, type, extraction_method, "
        "ingested_at, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        (
            source_id,
            f"https://example.com/{source_id}",
            "Shared Article",
            publication,
            "news_article",
            "manual",
        ),
    )
    for entry_id in entry_ids:
        await conn.execute(
            "INSERT INTO entry_sources (entry_id, source_id, created_at) "
            "VALUES (?, ?, datetime('now'))",
            (entry_id, source_id),
        )
    await conn.commit()
    return source_id


async def _tag_issue(conn: Any, entry_id: str, issue: str) -> None:
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
        "VALUES (?, ?, datetime('now'))",
        (entry_id, issue),
    )
    await conn.commit()


def _actor(result: Any, actor_id: str) -> Any:
    return next((a for a in result.actors if a.id == actor_id), None)


class TestPureHelpers:
    """The side-effect-free scoring helpers."""

    def test_tier_for_strength_boundaries(self) -> None:
        assert _tier_for_strength(100) == "strong"
        assert _tier_for_strength(67) == "strong"
        assert _tier_for_strength(66) == "moderate"
        assert _tier_for_strength(34) == "moderate"
        assert _tier_for_strength(33) == "weak"
        assert _tier_for_strength(0) == "weak"

    def test_pluralize(self) -> None:
        assert _pluralize(1, "source") == "1 source"
        assert _pluralize(0, "source") == "0 sources"
        assert _pluralize(3, "issue area") == "3 issue areas"

    def test_snippet(self) -> None:
        assert _snippet(cast("Any", SimpleNamespace(description="hello"))) == "hello"
        assert _snippet(cast("Any", SimpleNamespace(description=""))) is None
        assert _snippet(cast("Any", SimpleNamespace(description="x" * 200))) == "x" * 120


class TestSameOrganization:
    @pytest.mark.asyncio
    async def test_person_surfaces_org_and_coworkers(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Prairie Workers Cooperative")
        person_a = await _make_person(test_db, "Jane Doe", org_id=org_id)
        person_b = await _make_person(test_db, "John Smith", org_id=org_id)

        result = await compute_connections(test_db, person_a)

        org_actor = _actor(result, org_id)
        coworker = _actor(result, person_b)
        assert org_actor is not None
        assert org_actor.reasons[0].label == "Their organization"
        assert coworker is not None
        assert coworker.reasons[0].label == "Also at Prairie Workers Cooperative"

    @pytest.mark.asyncio
    async def test_person_alone_at_org_has_no_coworker(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Solo House")
        person_a = await _make_person(test_db, "Only Member", org_id=org_id)

        result = await compute_connections(test_db, person_a)

        assert result.total == 1
        assert _actor(result, org_id) is not None

    @pytest.mark.asyncio
    async def test_org_surfaces_team(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Affiliating Org")
        person_id = await _make_person(test_db, "Member", org_id=org_id)

        result = await compute_connections(test_db, org_id)

        member = _actor(result, person_id)
        assert member is not None
        assert member.reasons[0].label == "On the team at Affiliating Org"

    @pytest.mark.asyncio
    async def test_org_with_no_team_yields_nothing(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Empty Org")
        result = await compute_connections(test_db, org_id)
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_person_without_org_skips_affiliation(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Unaffiliated")
        result = await compute_connections(test_db, person_a)
        assert result.total == 0


class TestCoMentioned:
    @pytest.mark.asyncio
    async def test_shared_sources_counted_and_weighted(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe")
        person_b = await _make_person(test_db, "John Smith")
        await _co_mention(test_db, [person_a, person_b], publication="KC Star")
        await _co_mention(test_db, [person_a, person_b], publication="KC Star")

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        reason = actor.reasons[0]
        assert reason.kind == "co_mentioned"
        assert reason.count == SHARED_COUNT
        assert "2 sources" in reason.label
        assert "(KC Star)" in reason.label
        assert actor.score == SCORE_TWO_SOURCES

    @pytest.mark.asyncio
    async def test_co_mention_without_publication(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe")
        person_b = await _make_person(test_db, "John Smith")
        await _co_mention(test_db, [person_a, person_b], publication=None)

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        assert actor.reasons[0].label == "Co-mentioned in 1 source"


class TestSourcedEdges:
    @pytest.mark.asyncio
    async def test_sourced_relationship_edge_is_a_profile_connection(self, test_db: object) -> None:
        person_id = await _make_person(test_db, "Maya Lee")
        org_id = await _make_org(test_db, "Neighborhood Legal Center")
        source_id = await _co_mention(test_db, [person_id], publication="State Bar")
        await RelationshipCRUD.upsert_edge(
            test_db,
            source_entry_id=person_id,
            target_entry_id=org_id,
            relationship_type="staff",
            source_id=source_id,
            evidence_label="Staff profile",
            confidence=1.0,
        )

        result = await compute_connections(test_db, org_id)

        actor = _actor(result, person_id)
        assert actor is not None
        assert actor.score == SCORE_SOURCED_EDGE
        assert actor.reasons[0].kind == "sourced_edge"
        assert actor.reasons[0].relationship_type == "staff"
        assert actor.reasons[0].label == "Staff profile"
        assert actor.reasons[0].count == 1
        assert actor.reasons[0].source_id == source_id


class TestSameIssueArea:
    @pytest.mark.asyncio
    async def test_shared_issues_in_state_counted(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe", state="MO")
        person_b = await _make_person(test_db, "John Smith", state="MO")
        for issue in ("housing_affordability", "labor_rights"):
            await _tag_issue(test_db, person_a, issue)
            await _tag_issue(test_db, person_b, issue)

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        assert actor.reasons[0].kind == "same_issue_area"
        assert actor.reasons[0].count == SHARED_COUNT
        assert actor.reasons[0].label == "Shares 2 issue areas in MO"

    @pytest.mark.asyncio
    async def test_issue_without_state_is_skipped(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Stateless", state=None)
        person_b = await _make_person(test_db, "Other", state="MO")
        await _tag_issue(test_db, person_a, "housing_affordability")
        await _tag_issue(test_db, person_b, "housing_affordability")

        result = await compute_connections(test_db, person_a)
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_same_issue_different_state_excluded(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Missouri", state="MO")
        person_b = await _make_person(test_db, "Kansas", state="KS")
        await _tag_issue(test_db, person_a, "housing_affordability")
        await _tag_issue(test_db, person_b, "housing_affordability")

        result = await compute_connections(test_db, person_a)
        assert _actor(result, person_b) is None

    @pytest.mark.asyncio
    async def test_unique_issue_yields_no_match(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Lonely Advocate", state="MO")
        await _tag_issue(test_db, person_a, "rare_unique_issue")
        result = await compute_connections(test_db, person_a)
        assert result.total == 0


class TestGeographyBoost:
    @pytest.mark.asyncio
    async def test_same_city_boosts_an_existing_candidate(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe", city="Kansas City", state="MO")
        person_b = await _make_person(test_db, "John Smith", city="Kansas City", state="MO")
        await _co_mention(test_db, [person_a, person_b], publication=None)

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        assert actor.score == SCORE_BOOSTED  # co-mention plus same-city boost
        assert any(r.kind == "same_geography" for r in actor.reasons)

    @pytest.mark.asyncio
    async def test_geography_alone_is_not_a_connection(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe", city="Kansas City", state="MO")
        await _make_person(test_db, "Stranger", city="Kansas City", state="MO")

        result = await compute_connections(test_db, person_a)
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_different_city_candidate_not_boosted(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe", city="Kansas City", state="MO")
        person_b = await _make_person(test_db, "John Smith", city="St. Louis", state="MO")
        await _co_mention(test_db, [person_a, person_b], publication=None)

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        assert actor.score == SCORE_CO_MENTION  # co-mention only, no boost
        assert all(r.kind != "same_geography" for r in actor.reasons)

    @pytest.mark.asyncio
    async def test_entry_with_city_but_no_links(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Solo", city="Kansas City", state="MO")
        result = await compute_connections(test_db, person_a)
        assert result.total == 0


class TestRankingAndShape:
    @pytest.mark.asyncio
    async def test_ranked_by_strength_and_normalized(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Anchor Org")
        person_a = await _make_person(test_db, "Center", org_id=org_id)
        strong = await _make_person(test_db, "Strong Tie", org_id=org_id)  # affiliation: 5.0
        weak = await _make_person(test_db, "Weak Tie")
        await _co_mention(test_db, [person_a, weak], publication=None)  # co-mention: 2.0

        result = await compute_connections(test_db, person_a)

        top = result.actors[0]
        assert top.id in {org_id, strong}
        assert top.strength == STRENGTH_FULL
        assert top.tier == "strong"
        weak_actor = _actor(result, weak)
        assert weak_actor is not None
        assert weak_actor.strength == STRENGTH_WEAK  # 2.0 / 5.0 * 100
        assert weak_actor.tier == "moderate"
        assert weak_actor.evidence == weak_actor.reasons[0].label

    @pytest.mark.asyncio
    async def test_evidence_is_strongest_reason(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Shared Org")
        person_a = await _make_person(test_db, "Center", org_id=org_id)
        both = await _make_person(test_db, "Both Ties", org_id=org_id)
        await _co_mention(test_db, [person_a, both], publication="Local Paper")

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, both)
        assert actor is not None
        # Affiliation is added before co-mention, so it leads the reasons + evidence.
        assert actor.reasons[0].kind == "same_organization"
        assert actor.evidence == "Also at Shared Org"
        assert any(r.kind == "co_mentioned" for r in actor.reasons)

    @pytest.mark.asyncio
    async def test_total_and_pagination(self, test_db: object) -> None:
        org_id = await _make_org(test_db, "Big Org")
        person_a = await _make_person(test_db, "Center", org_id=org_id)
        for index in range(3):
            await _make_person(test_db, f"Member {index}", org_id=org_id)

        full = await compute_connections(test_db, person_a)
        assert full.total == EXPECTED_TOTAL  # org + 3 coworkers

        page = await compute_connections(test_db, person_a, limit=2, offset=0)
        assert len(page.actors) == PAGE_SIZE
        assert page.total == EXPECTED_TOTAL

        tail = await compute_connections(test_db, person_a, limit=2, offset=2)
        assert len(tail.actors) == PAGE_SIZE
        assert page.actors[0].id != tail.actors[0].id


class TestEmptyCases:
    @pytest.mark.asyncio
    async def test_isolated_entry(self, test_db: object) -> None:
        entry_id = await _make_person(test_db, "Isolated Person")
        result = await compute_connections(test_db, entry_id)
        assert result.actors == []
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_unknown_entry(self, test_db: object) -> None:
        result = await compute_connections(test_db, "no-such-entry-id")
        assert result.actors == []
        assert result.total == 0


class TestConnectionsEndpoint:
    @pytest.mark.asyncio
    async def test_returns_ranked_actors_and_total(
        self, test_client: object, test_db: object
    ) -> None:
        org_id = await _make_org(test_db, "Test Org")
        await _make_person(test_db, "Person A", org_id=org_id)
        person_b = await _make_person(test_db, "Person B", org_id=org_id)

        response = await test_client.get(f"/api/entities/{person_b}/connections")

        assert response.status_code == STATUS_OK
        data = response.json()
        assert "actors" in data
        assert "total" in data
        assert len(data["actors"]) > 0
        assert "strength" in data["actors"][0]
        assert "reasons" in data["actors"][0]

    @pytest.mark.asyncio
    async def test_pagination_query_param(self, test_client: object, test_db: object) -> None:
        org_id = await _make_org(test_db, "Paged Org")
        person_a = await _make_person(test_db, "Anchor", org_id=org_id)
        await _make_person(test_db, "Teammate", org_id=org_id)

        response = await test_client.get(f"/api/entities/{person_a}/connections?limit=1")

        assert response.status_code == STATUS_OK
        data = response.json()
        assert len(data["actors"]) == 1
        assert data["total"] >= MIN_TOTAL
