"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp.elicitation import (
    CLIENT_CAPABILITIES_META_KEY,
    URL_ELICITATION_REQUIRED,
    ElicitationSchemaError,
    PlaceClarification,
    ResolveIssueAreasClarification,
    SearchEntitiesClarification,
    build_first_party_elicitation_url,
    build_form_elicitation_request,
    build_url_elicitation_request,
    build_url_elicitation_required_error,
    clarify_place_argument,
    clarify_resolve_issue_areas_result,
    clarify_search_entities_arguments,
    complete_url_elicitation_state,
    create_url_elicitation_state,
    declares_elicitation_mode,
    declares_form_elicitation,
    declares_url_elicitation,
    get_url_elicitation_state,
    log_elicitation_event,
    should_elicit_place_clarification,
    should_elicit_search_entities_clarification,
    validate_form_requested_schema,
)


def _meta(capabilities: dict[str, Any]) -> dict[str, Any]:
    return {CLIENT_CAPABILITIES_META_KEY: capabilities}


QUICK_RESULT_LIMIT = 10
STANDARD_RESULT_LIMIT = 20
DEEP_RESULT_LIMIT = 50
SELECTED_ISSUE_COUNT = 2


def _assert_log_omits_private_values(log_kwargs: dict[str, Any], values: set[str]) -> None:
    rendered = repr(log_kwargs)
    for value in values:
        assert value not in rendered


class TestElicitationCapabilities:
    def test_ignores_missing_or_malformed_metadata(self) -> None:
        assert declares_form_elicitation(None) is False
        assert declares_form_elicitation("not metadata") is False
        assert (
            declares_form_elicitation({CLIENT_CAPABILITIES_META_KEY: "not capabilities"}) is False
        )
        assert declares_form_elicitation(_meta({"elicitation": "not elicitation"})) is False

    def test_accepts_metadata_model_with_model_dump(self) -> None:
        class MetadataModel:
            def model_dump(self, **kwargs: object) -> dict[str, Any]:
                assert kwargs == {"by_alias": True, "exclude_none": True}
                return _meta({"elicitation": {"form": {}}})

        assert declares_form_elicitation(MetadataModel()) is True

    def test_form_mode_requires_elicitation_capability(self) -> None:
        assert declares_form_elicitation(_meta({})) is False

    def test_empty_elicitation_capability_means_form(
        self,
    ) -> None:
        assert declares_form_elicitation(_meta({"elicitation": {}})) is True

    def test_explicit_form_mode_is_supported(self) -> None:
        assert declares_form_elicitation(_meta({"elicitation": {"form": {}}})) is True

    def test_form_flag_disables_support(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "atlas.platform.mcp.elicitation.get_settings",
            lambda: SimpleNamespace(mcp_form_elicitation_enabled=False),
        )

        assert declares_form_elicitation(_meta({"elicitation": {"form": {}}})) is False

    def test_url_mode_requires_explicit_url_capability(self) -> None:
        assert declares_url_elicitation(_meta({"elicitation": {}})) is False
        assert declares_url_elicitation(_meta({"elicitation": {"url": {}}})) is True

    def test_capability_helpers_accept_sdk_model(self) -> None:
        capabilities = types.ClientCapabilities(
            elicitation=types.ElicitationCapability(
                form=types.FormElicitationCapability(),
                url=types.UrlElicitationCapability(),
            )
        )
        assert declares_form_elicitation(_meta(capabilities.model_dump(exclude_none=True))) is True
        assert declares_url_elicitation(_meta(capabilities.model_dump(exclude_none=True))) is True

    def test_mode_helper_rejects_unknown_mode(self) -> None:
        with pytest.raises(ValueError, match="Unsupported elicitation mode"):
            declares_elicitation_mode(_meta({"elicitation": {}}), "modal")  # type: ignore[arg-type]

    def test_mode_helper_dispatches_supported_modes(self) -> None:
        meta = _meta({"elicitation": {"form": {}, "url": {}}})
        assert declares_elicitation_mode(meta, "form") is True
        assert declares_elicitation_mode(meta, "url") is True


class TestUrlElicitationState:
    def test_first_party_url_only_has_id(self) -> None:
        url = build_first_party_elicitation_url(
            public_url="https://atlas.example.com/app/",
            path="/account",
            elicitation_id="eli_1",
        )

        assert url == "https://atlas.example.com/account?mcpElicitationId=eli_1"

    def test_build_first_party_url_rejects_relative_public_url(self) -> None:
        with pytest.raises(ValueError, match="absolute URL"):
            build_first_party_elicitation_url(
                public_url="/relative",
                path="/account",
                elicitation_id="eli_1",
            )

    def test_url_state_is_retrievable_before_expiry(self) -> None:
        now = datetime.now(UTC)
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            now=now,
        )

        assert state.user_id == "user_1"
        assert state.org_id == "org_1"
        assert state.expires_at == now + timedelta(minutes=15)
        assert get_url_elicitation_state(state.elicitation_id) == state

    def test_expired_url_state_is_not_returned(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            now=datetime(2000, 1, 1, tzinfo=UTC),
        )

        assert get_url_elicitation_state(state.elicitation_id) is None

    @pytest.mark.asyncio
    async def test_expired_completion_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            now=datetime(2000, 1, 1, tzinfo=UTC),
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_1",
                org_id="org_1",
            )

        assert completed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "expired"
        _assert_log_omits_private_values(
            log_mock.await_args.kwargs,
            {state.elicitation_id, "user_1", "org_1", "mcpElicitationId"},
        )

    @pytest.mark.asyncio
    async def test_matching_actor_completes_url_state(self) -> None:
        session = SimpleNamespace(send_elicit_complete=AsyncMock())
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            session=session,
        )

        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )

        assert completed is not None
        assert completed.completed_at is not None
        assert completed.target_flow == "billing_settings"
        assert get_url_elicitation_state(state.elicitation_id) is None
        session.send_elicit_complete.assert_awaited_once_with(elicitation_id=state.elicitation_id)

    @pytest.mark.asyncio
    async def test_mismatched_actor_cannot_complete_state(self) -> None:
        session = SimpleNamespace(send_elicit_complete=AsyncMock())
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            session=session,
        )

        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_2",
            org_id="org_1",
        )

        assert completed is None
        assert get_url_elicitation_state(state.elicitation_id) == state
        session.send_elicit_complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_mismatched_completion_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_2",
                org_id="org_1",
            )

        assert completed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "identity_mismatch"
        _assert_log_omits_private_values(
            log_mock.await_args.kwargs,
            {state.elicitation_id, "user_1", "user_2", "org_1", "mcpElicitationId"},
        )

    @pytest.mark.asyncio
    async def test_completed_state_cannot_be_reused(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )

        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )
        replayed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )

        assert completed is not None
        assert replayed is None

    @pytest.mark.asyncio
    async def test_reused_completion_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )
        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            replayed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_1",
                org_id="org_1",
            )

        assert completed is not None
        assert replayed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "already_completed"
        _assert_log_omits_private_values(
            log_mock.await_args.kwargs,
            {state.elicitation_id, "user_1", "org_1", "mcpElicitationId"},
        )


class FakeElicitationContext:
    def __init__(self, *, meta: object | None, result: object) -> None:
        self.request_context = SimpleNamespace(meta=meta)
        self.result = result
        self.messages: list[str] = []
        self.schemas: list[type[object]] = []

    async def elicit(self, *, message: str, schema: type[object]) -> object:
        self.messages.append(message)
        self.schemas.append(schema)
        return self.result


class BrokenContext:
    @property
    def request_context(self) -> object:
        raise ValueError


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


class TestResolveIssueAreasClarification:
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


class TestElicitationLogging:
    @pytest.mark.asyncio
    async def test_lifecycle_log_omits_content(self) -> None:
        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            await log_elicitation_event(
                interaction="discovery_run_preflight",
                mode="form",
                action="decline",
            )

        log_mock.assert_awaited_once()
        kwargs = log_mock.await_args.kwargs
        assert kwargs["logger"] == "atlas.mcp.elicitation"
        assert kwargs["message"] == (
            "The user declined the elicitation; Atlas used the safe fallback. "
            "(discovery run preflight)"
        )
        assert kwargs["interaction"] == "discovery_run_preflight"
        assert kwargs["mode"] == "form"
        assert kwargs["action"] == "decline"
        assert kwargs["next_step"] == "use_safe_fallback"
        assert "content" not in kwargs
        assert "location_query" not in kwargs
        assert "issue_areas" not in kwargs

    @pytest.mark.asyncio
    async def test_unavailable_log_is_generic(self) -> None:
        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            await log_elicitation_event(
                interaction="url_completion_notification",
                mode="url",
                action="unavailable",
            )

        assert log_mock.await_args.kwargs["message"] == (
            "Atlas could not complete the elicitation update. (URL completion notification)"
        )


class TestFormSchemaValidation:
    def test_accepts_flat_primitive_schema(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "place": {"type": "string", "title": "Place"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                "include_single_source": {"type": "boolean", "default": True},
            },
            "required": ["place"],
        }

        assert validate_form_requested_schema(schema) == schema

    def test_accepts_single_select_enum_with_titles(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "evidence_threshold": {
                    "type": "string",
                    "oneOf": [
                        {"const": "any_source_backed_leads", "title": "Any source-backed leads"},
                        {"const": "multiple_independent_sources", "title": "Multiple sources"},
                    ],
                }
            },
        }

        assert validate_form_requested_schema(schema) == schema

    def test_accepts_multi_select_enum_with_titles(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "actor_types": {
                    "type": "array",
                    "items": {
                        "anyOf": [
                            {"const": "person", "title": "People"},
                            {"const": "organization", "title": "Organizations"},
                        ]
                    },
                    "minItems": 1,
                    "maxItems": 2,
                }
            },
        }

        assert validate_form_requested_schema(schema) == schema

    def test_accepts_multi_select_enum_without_titles(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "actor_types": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["person", "organization"]},
                }
            },
        }

        assert validate_form_requested_schema(schema) == schema

    def test_accepts_one_of_string_enum_without_type(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "place": {
                    "oneOf": [
                        {"const": "kansas_city_mo", "title": "Kansas City, MO"},
                        {"const": "kansas_city_ks", "title": "Kansas City, KS"},
                    ]
                }
            },
        }

        assert validate_form_requested_schema(schema) == schema

    def test_rejects_non_object_root(self) -> None:
        with pytest.raises(ElicitationSchemaError, match="requestedSchema must be an object"):
            validate_form_requested_schema([])  # type: ignore[arg-type]

    def test_rejects_root_without_object_type(self) -> None:
        with pytest.raises(ElicitationSchemaError, match=r"requestedSchema\.type"):
            validate_form_requested_schema({"properties": {}})

    def test_rejects_missing_properties_object(self) -> None:
        with pytest.raises(ElicitationSchemaError, match=r"requestedSchema\.properties"):
            validate_form_requested_schema({"type": "object", "properties": []})

    def test_rejects_non_object_property_schema(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "place": "not a schema",
            },
        }

        with pytest.raises(ElicitationSchemaError, match="place must be an object"):
            validate_form_requested_schema(schema)

    def test_rejects_nested_objects(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "workspace": {
                    "type": "object",
                    "properties": {"visibility": {"type": "string"}},
                }
            },
        }

        with pytest.raises(ElicitationSchemaError, match="workspace"):
            validate_form_requested_schema(schema)

    def test_rejects_unsupported_property_type(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "filters": {"type": "null"},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="primitive"):
            validate_form_requested_schema(schema)

    def test_rejects_secret_like_fields(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "api_key": {"type": "string"},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="sensitive"):
            validate_form_requested_schema(schema)

    def test_secret_field_blocker_logs_no_field_name(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        schema = {
            "type": "object",
            "properties": {
                "api_key": {"type": "string"},
            },
        }

        with (
            caplog.at_level(logging.INFO, logger="atlas.mcp.elicitation"),
            pytest.raises(ElicitationSchemaError, match="sensitive"),
        ):
            validate_form_requested_schema(schema)

        assert caplog.messages == [
            "Atlas blocked a form-mode elicitation schema that requested sensitive information."
        ]
        assert "api_key" not in caplog.text

    def test_rejects_empty_string_enum(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "evidence_threshold": {"type": "string", "enum": []},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="non-empty string enum"):
            validate_form_requested_schema(schema)

    def test_rejects_non_string_enum_value(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "evidence_threshold": {"type": "string", "enum": ["recent", 1]},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="string enum"):
            validate_form_requested_schema(schema)

    def test_rejects_empty_one_of_options(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "evidence_threshold": {"type": "string", "oneOf": []},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="non-empty string enum options"):
            validate_form_requested_schema(schema)

    def test_rejects_malformed_one_of_option(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "evidence_threshold": {"type": "string", "oneOf": ["recent"]},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="must be an object"):
            validate_form_requested_schema(schema)

    def test_rejects_non_string_one_of_const(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "evidence_threshold": {"type": "string", "oneOf": [{"const": 1}]},
            },
        }

        with pytest.raises(ElicitationSchemaError, match="string enum options"):
            validate_form_requested_schema(schema)

    def test_rejects_missing_array_items(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "actor_types": {"type": "array"},
            },
        }

        with pytest.raises(ElicitationSchemaError, match=r"actor_types\.items"):
            validate_form_requested_schema(schema)

    def test_rejects_non_string_array_items(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "scores": {
                    "type": "array",
                    "items": {"type": "integer", "enum": [1, 2]},
                }
            },
        }

        with pytest.raises(ElicitationSchemaError, match="string enum"):
            validate_form_requested_schema(schema)

    def test_rejects_invalid_required_shape(self) -> None:
        schema = {
            "type": "object",
            "properties": {"place": {"type": "string"}},
            "required": ["place", 1],
        }

        with pytest.raises(ElicitationSchemaError, match="required"):
            validate_form_requested_schema(schema)

    def test_rejects_unknown_required_field(self) -> None:
        schema = {
            "type": "object",
            "properties": {"place": {"type": "string"}},
            "required": ["state"],
        }

        with pytest.raises(ElicitationSchemaError, match="unknown fields: state"):
            validate_form_requested_schema(schema)


class TestRequestBuilders:
    def test_builds_form_request_with_schema(self) -> None:
        request = build_form_elicitation_request(
            message="Choose the place to search.",
            requested_schema={
                "type": "object",
                "properties": {"place": {"type": "string"}},
                "required": ["place"],
            },
        )

        assert isinstance(request, types.ElicitRequest)
        assert request.method == "elicitation/create"
        assert request.params.mode == "form"
        assert request.params.message == "Choose the place to search."
        assert request.params.requestedSchema["properties"]["place"]["type"] == "string"

    def test_build_form_request_rejects_sensitive_schema(self) -> None:
        with pytest.raises(ElicitationSchemaError, match="sensitive"):
            build_form_elicitation_request(
                message="Enter credentials.",
                requested_schema={
                    "type": "object",
                    "properties": {"password": {"type": "string"}},
                },
            )

    def test_builds_url_elicitation_request(self) -> None:
        request = build_url_elicitation_request(
            message="Open Atlas to connect Google Sheets.",
            url="https://atlas.example/connect?elicitationId=eli_1",
            elicitation_id="eli_1",
        )

        assert isinstance(request, types.ElicitRequest)
        assert request.params.mode == "url"
        assert request.params.message == "Open Atlas to connect Google Sheets."
        assert request.params.url == "https://atlas.example/connect?elicitationId=eli_1"
        assert request.params.elicitationId == "eli_1"

    def test_builds_url_elicitation_required_error(self) -> None:
        error = build_url_elicitation_required_error(
            message="Authorization is required to access billing settings.",
            elicitations=[
                build_url_elicitation_request(
                    message="Open Atlas account settings.",
                    url="https://atlas.example/account?mcpElicitationId=eli_1",
                    elicitation_id="eli_1",
                )
            ],
        )

        assert isinstance(error, McpError)
        assert error.error.code == URL_ELICITATION_REQUIRED
        assert error.error.message == "Authorization is required to access billing settings."
        assert error.error.data == {
            "elicitations": [
                {
                    "mode": "url",
                    "message": "Open Atlas account settings.",
                    "url": "https://atlas.example/account?mcpElicitationId=eli_1",
                    "elicitationId": "eli_1",
                }
            ]
        }

    def test_url_required_error_rejects_forms(self) -> None:
        with pytest.raises(TypeError, match="only include URL elicitations"):
            build_url_elicitation_required_error(
                message="URL completion is required.",
                elicitations=[
                    build_form_elicitation_request(
                        message="Choose a place.",
                        requested_schema={
                            "type": "object",
                            "properties": {"place": {"type": "string"}},
                            "required": ["place"],
                        },
                    )
                ],
            )
