"""Tests for co-mentioned connection behavior."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections

from .helpers import _actor, _co_mention, _make_person


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
        assert reason.count == 2
        assert "2 sources" in reason.label
        assert "(KC Star)" in reason.label
        assert actor.score == 4.0

    @pytest.mark.asyncio
    async def test_co_mention_without_publication(self, test_db: object) -> None:
        person_a = await _make_person(test_db, "Jane Doe")
        person_b = await _make_person(test_db, "John Smith")
        await _co_mention(test_db, [person_a, person_b], publication=None)

        result = await compute_connections(test_db, person_a)

        actor = _actor(result, person_b)
        assert actor is not None
        assert actor.reasons[0].label == "Co-mentioned in 1 source"
