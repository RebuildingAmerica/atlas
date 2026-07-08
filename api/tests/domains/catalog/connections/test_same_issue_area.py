"""Tests for same issue-area connection behavior."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.connections import compute_connections

from .helpers import _actor, _make_person, _tag_issue


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
        assert actor.reasons[0].count == 2
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
