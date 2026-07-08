"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.platform.mcp import elicitation as elicitation_module
from atlas.platform.mcp.elicitation import (
    ResolveIssueAreasClarification,
    SearchEntitiesClarification,
    clarify_resolve_issue_areas_result,
)
from tests.support.mcp_elicitation import (
    SELECTED_ISSUE_COUNT,
    FakeElicitationContext,
    _meta,
)


class TestResolveIssueAreasClarification:
    def test_issue_area_matching_helpers_ignore_unusable_items(self) -> None:
        assert elicitation_module._issue_match_slug("not a match") is None  # noqa: SLF001
        assert elicitation_module._issue_match_score("not a match") == 0.0  # noqa: SLF001
        assert (
            elicitation_module._should_elicit_issue_area_selection(  # noqa: SLF001
                {"items": [{"slug": "housing_affordability", "match_score": 5}]}
            )
            is False
        )
        assert (
            elicitation_module._should_elicit_issue_area_selection(  # noqa: SLF001
                {"items": [{"slug": "not_real", "match_score": 5}, {"name": "No slug"}]}
            )
            is False
        )

    def test_issue_area_filter_keeps_payload_when_selection_is_unusable(self) -> None:
        payload = {
            "items": [{"slug": "housing_affordability", "match_score": 5}],
            "total": 1,
            "next_cursor": "cursor_2",
        }

        assert (
            elicitation_module._filter_issue_area_payload(payload, []) is payload  # noqa: SLF001
        )
        assert (
            elicitation_module._filter_issue_area_payload(  # noqa: SLF001
                {"items": "not a list"}, ["housing_affordability"]
            )["items"]
            == "not a list"
        )
        assert (
            elicitation_module._filter_issue_area_payload(  # noqa: SLF001
                payload, ["transportation_and_mobility"]
            )
            is payload
        )

    @pytest.mark.asyncio
    async def test_accepted_issue_matches_filter_slugs(self) -> None:
        payload = {
            "items": [
                {"slug": "housing_affordability", "name": "Housing", "match_score": 5},
                {
                    "slug": "homelessness_and_housing_insecurity",
                    "name": "Homelessness",
                    "match_score": 4,
                },
                {"slug": "public_transit", "name": "Public Transit", "match_score": 3},
            ],
            "total": 3,
            "next_cursor": None,
        }
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(
                action="accept",
                data=ResolveIssueAreasClarification(
                    issue_areas=["homelessness_and_housing_insecurity", "public_transit"]
                ),
            ),
        )

        clarified = await clarify_resolve_issue_areas_result(ctx, payload)

        assert [item["slug"] for item in clarified["items"]] == [
            "homelessness_and_housing_insecurity",
            "public_transit",
        ]
        assert clarified["total"] == SELECTED_ISSUE_COUNT
        assert ctx.schemas == [ResolveIssueAreasClarification]

    def test_resolve_issue_area_clarification_rejects_unknown_slug(self) -> None:
        with pytest.raises(ValueError, match="Unknown Atlas issue area slug"):
            ResolveIssueAreasClarification(issue_areas=["not_a_real_issue"])

    def test_search_rejects_unknown_issue_slug(self) -> None:
        with pytest.raises(ValueError, match="Unknown Atlas issue area slug"):
            SearchEntitiesClarification(issue_areas=["not_a_real_issue"])

    @pytest.mark.asyncio
    async def test_declined_issue_matches_stay_same(self) -> None:
        payload = {
            "items": [
                {"slug": "housing_affordability", "name": "Housing", "match_score": 5},
                {
                    "slug": "homelessness_and_housing_insecurity",
                    "name": "Homelessness",
                    "match_score": 4,
                },
            ],
            "total": 2,
            "next_cursor": None,
        }
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(action="decline"),
        )

        clarified = await clarify_resolve_issue_areas_result(ctx, payload)

        assert clarified == payload

    @pytest.mark.asyncio
    async def test_unsupported_issue_match_client_keeps_payload(self) -> None:
        payload = {
            "items": [
                {"slug": "housing_affordability", "name": "Housing", "match_score": 5},
                {
                    "slug": "homelessness_and_housing_insecurity",
                    "name": "Homelessness",
                    "match_score": 4,
                },
            ],
            "total": 2,
            "next_cursor": None,
        }

        assert await clarify_resolve_issue_areas_result(None, payload) == payload

    @pytest.mark.asyncio
    async def test_unambiguous_issue_match_payload_skips_elicitation(self) -> None:
        payload = {
            "items": [{"slug": "housing_affordability", "name": "Housing", "match_score": 5}],
            "total": 1,
            "next_cursor": None,
        }

        assert await clarify_resolve_issue_areas_result(None, payload) == payload
