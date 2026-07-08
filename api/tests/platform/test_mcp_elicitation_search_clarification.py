"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.platform.mcp import elicitation as elicitation_module
from atlas.platform.mcp.elicitation import (
    PlaceClarification,
    SearchEntitiesClarification,
    clarify_place_argument,
    clarify_search_entities_arguments,
    should_elicit_place_clarification,
    should_elicit_search_entities_clarification,
)
from tests.support.mcp_elicitation import (
    DEEP_RESULT_LIMIT,
    QUICK_RESULT_LIMIT,
    STANDARD_RESULT_LIMIT,
    BrokenContext,
    FakeElicitationContext,
    _meta,
)


class TestSearchEntitiesClarification:
    @pytest.mark.parametrize("place", ["Kansas City", "Portland", "Springfield", "Washington"])
    def test_unqualified_places_can_elicit(self, place: str) -> None:
        assert should_elicit_place_clarification(place=place) is True

    @pytest.mark.parametrize(
        "place",
        ["Kansas City, MO", "Portland, ME", "Gary", "Detroit, MI", "Washington, DC"],
    )
    def test_qualified_places_do_not_elicit(
        self,
        place: str,
    ) -> None:
        assert should_elicit_place_clarification(place=place) is False

    @pytest.mark.asyncio
    async def test_unsupported_client_keeps_place(self) -> None:
        assert await clarify_place_argument(None, place="Portland") == "Portland"

    @pytest.mark.asyncio
    async def test_unambiguous_place_skips_elicitation(self) -> None:
        assert await clarify_place_argument(None, place="Detroit, MI") == "Detroit, MI"

    @pytest.mark.asyncio
    async def test_declined_place_keeps_original(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(action="decline"),
        )

        assert await clarify_place_argument(ctx, place="Springfield") == "Springfield"
        assert ctx.messages == ["Choose the specific place for this lookup."]
        assert ctx.schemas == [PlaceClarification]

    @pytest.mark.asyncio
    async def test_accepted_place_applies_trimmed_value(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {}}),
            result=SimpleNamespace(
                action="accept",
                data=PlaceClarification(place=" Springfield, MA "),
            ),
        )

        assert await clarify_place_argument(ctx, place="Springfield") == "Springfield, MA"
        assert ctx.schemas == [PlaceClarification]

    def test_broad_first_page_search_can_elicit(self) -> None:
        assert (
            should_elicit_search_entities_clarification(
                place=None,
                issue_areas=None,
                text=None,
                entity_types=None,
                source_types=None,
                cursor=None,
            )
            is True
        )

    @pytest.mark.parametrize(
        ("place", "issue_areas", "text", "entity_types", "source_types", "cursor"),
        [
            ("Gary, IN", None, None, None, None, None),
            (None, ["housing"], None, None, None, None),
            (None, None, "transit", None, None, None),
            (None, None, None, ["organization"], None, None),
            (None, None, None, None, ["news"], None),
            (None, None, None, None, None, "20"),
        ],
    )
    def test_scoped_search_does_not_elicit(  # noqa: PLR0913
        self,
        place: str | None,
        issue_areas: list[str] | None,
        text: str | None,
        entity_types: list[str] | None,
        source_types: list[str] | None,
        cursor: str | None,
    ) -> None:
        assert (
            should_elicit_search_entities_clarification(
                place=place,
                issue_areas=issue_areas,
                text=text,
                entity_types=entity_types,
                source_types=source_types,
                cursor=cursor,
            )
            is False
        )

    @pytest.mark.asyncio
    async def test_unsupported_client_keeps_search_args(self) -> None:
        arguments = await clarify_search_entities_arguments(
            None,
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=STANDARD_RESULT_LIMIT,
            cursor=None,
        )

        assert arguments == {
            "place": None,
            "issue_areas": None,
            "text": None,
            "entity_types": None,
            "source_types": None,
            "limit": 20,
            "cursor": None,
        }

    @pytest.mark.asyncio
    async def test_smoke_form_client(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(
                action="accept",
                data=SearchEntitiesClarification(place=" Detroit, MI ", result_depth="quick"),
            ),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=20,
            cursor=None,
        )

        assert arguments["place"] == "Detroit, MI"
        assert arguments["limit"] == QUICK_RESULT_LIMIT
        assert ctx.schemas == [SearchEntitiesClarification]

    @pytest.mark.asyncio
    async def test_smoke_unsupported_client(self) -> None:
        arguments = await clarify_search_entities_arguments(
            FakeElicitationContext(meta=_meta({}), result=SimpleNamespace(action="accept")),
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=STANDARD_RESULT_LIMIT,
            cursor=None,
        )

        assert arguments == {
            "place": None,
            "issue_areas": None,
            "text": None,
            "entity_types": None,
            "source_types": None,
            "limit": STANDARD_RESULT_LIMIT,
            "cursor": None,
        }

    @pytest.mark.asyncio
    async def test_missing_context_keeps_search_args(self) -> None:
        arguments = await clarify_search_entities_arguments(
            BrokenContext(),
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=20,
            cursor=None,
        )

        assert arguments["place"] is None
        assert arguments["text"] is None

    @pytest.mark.asyncio
    async def test_declined_search_keeps_args(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(action="decline"),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=20,
            cursor=None,
        )

        assert arguments["place"] is None
        assert arguments["text"] is None
        assert ctx.messages == [
            "Choose a place, search phrase, or source-backing preference for the results."
        ]
        assert ctx.schemas == [SearchEntitiesClarification]

    @pytest.mark.asyncio
    async def test_accepted_search_applies_trimmed_args(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {}}),
            result=SimpleNamespace(
                action="accept",
                data=SearchEntitiesClarification(place=" Gary, IN ", text=" housing "),
            ),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=20,
            cursor=None,
        )

        assert arguments["place"] == "Gary, IN"
        assert arguments["text"] == "housing"

    @pytest.mark.asyncio
    async def test_accepted_search_applies_choices(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(
                action="accept",
                data=SearchEntitiesClarification(
                    issue_areas=["housing_affordability", "transportation_and_mobility"],
                    actor_types=["person", "organization"],
                    result_depth="deep",
                ),
            ),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=20,
            cursor=None,
        )

        assert arguments["issue_areas"] == [
            "housing_affordability",
            "transportation_and_mobility",
        ]
        assert arguments["entity_types"] == ["person", "organization"]
        assert arguments["limit"] == DEEP_RESULT_LIMIT

    def test_search_clarification_ignores_empty_or_unknown_choices(self) -> None:
        assert elicitation_module._has_value(1) is True  # noqa: SLF001
        clarified = elicitation_module._apply_search_entities_clarification(  # noqa: SLF001
            {"issue_areas": ["worker_power"], "entity_types": ["person"], "limit": 20},
            SearchEntitiesClarification.model_construct(
                issue_areas=["unknown_issue"],
                actor_types=[""],
                result_depth=None,
                evidence_threshold=None,
            ),
        )

        assert clarified == {
            "issue_areas": ["worker_power"],
            "entity_types": ["person"],
            "limit": 20,
        }

    @pytest.mark.asyncio
    async def test_accepted_search_prioritizes_sources(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(
                action="accept",
                data=SearchEntitiesClarification(evidence_threshold="more_source_backed"),
            ),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place=None,
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=20,
            cursor=None,
        )

        assert arguments["sort"] == "source_count"

    @pytest.mark.asyncio
    async def test_empty_search_choices_keep_scope(
        self,
    ) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(
                action="accept",
                data=SearchEntitiesClarification(
                    issue_areas=[],
                    actor_types=[],
                    result_depth=None,
                ),
            ),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place=None,
            issue_areas=["worker_power"],
            text=None,
            entity_types=["initiative"],
            source_types=None,
            limit=STANDARD_RESULT_LIMIT,
            cursor=None,
        )

        assert arguments["issue_areas"] == ["worker_power"]
        assert arguments["entity_types"] == ["initiative"]
        assert arguments["limit"] == STANDARD_RESULT_LIMIT

    @pytest.mark.asyncio
    async def test_place_scoped_search_can_elicit_scope(self) -> None:
        ctx = FakeElicitationContext(
            meta=_meta({"elicitation": {"form": {}}}),
            result=SimpleNamespace(
                action="accept",
                data=SearchEntitiesClarification(
                    actor_types=["organization"],
                    result_depth="quick",
                ),
            ),
        )

        arguments = await clarify_search_entities_arguments(
            ctx,
            place="Detroit, MI",
            issue_areas=None,
            text=None,
            entity_types=None,
            source_types=None,
            limit=STANDARD_RESULT_LIMIT,
            cursor=None,
            allow_place_scoped_clarification=True,
        )

        assert arguments["place"] == "Detroit, MI"
        assert arguments["entity_types"] == ["organization"]
        assert arguments["limit"] == QUICK_RESULT_LIMIT
