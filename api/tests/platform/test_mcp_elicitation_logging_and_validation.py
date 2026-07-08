"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

import logging

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp.elicitation import (
    URL_ELICITATION_REQUIRED,
    ElicitationSchemaError,
    build_form_elicitation_request,
    build_url_elicitation_request,
    build_url_elicitation_required_error,
    validate_form_requested_schema,
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
