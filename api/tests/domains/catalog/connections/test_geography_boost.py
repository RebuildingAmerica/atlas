"""Tests for geography boost behavior."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections

from .helpers import _actor, _co_mention, _make_person


class TestGeographyBoost:
    @pytest.mark.asyncio
    async def test_same_city_boosts_an_existing_candidate(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe", city="Kansas City", state="MO")
        person_b = await _make_person(test_db, "John Smith", city="Kansas City", state="MO")
        await _co_mention(test_db, [person_a, person_b], publication=None)

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        assert actor.score == 2.5
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
        assert actor.score == 2.0
        assert all(r.kind != "same_geography" for r in actor.reasons)

    @pytest.mark.asyncio
    async def test_entry_with_city_but_no_links(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Solo", city="Kansas City", state="MO")
        result = await compute_connections(test_db, person_a)
        assert result.total == 0
