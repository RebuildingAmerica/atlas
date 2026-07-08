"""Elicitation schema and request helpers for `atlas.platform.mcp.elicitation`."""
# ruff: noqa: TRY003

from __future__ import annotations

from typing import Any, cast

from mcp import types
from mcp.shared.exceptions import McpError

from .elicitation_core import (
    _ACTION_MESSAGES,
    _ACTION_NEXT_STEPS,
    _INTERACTION_LABELS,
    _PRIMITIVE_TYPES,
    _SENSITIVE_FIELD_RE,
    URL_ELICITATION_REQUIRED,
    ElicitationMode,
    _logger,
    _schema_error,
)


async def log_elicitation_event(
    *,
    interaction: str,
    mode: ElicitationMode,
    action: str,
) -> None:
    """Emit privacy-safe elicitation lifecycle telemetry."""
    from . import elicitation as elicitation_module

    label = _INTERACTION_LABELS.get(interaction, interaction)
    message = _ACTION_MESSAGES.get(action, "Atlas handled an elicitation event.")
    await elicitation_module.log_operation(
        logger="atlas.mcp.elicitation",
        level="info",
        message=f"{message} ({label})",
        interaction=interaction,
        mode=mode,
        action=action,
        next_step=_ACTION_NEXT_STEPS.get(action, "review_elicitation_event"),
    )


def _reject_sensitive_property_name(name: str) -> None:
    normalized = name.replace(".", "_")
    if _SENSITIVE_FIELD_RE.search(normalized):
        _logger.info(
            "Atlas blocked a form-mode elicitation schema that requested sensitive information."
        )
        raise _schema_error(f"Form mode elicitation cannot request sensitive field `{name}`.")


def _ensure_object(value: object, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _schema_error(f"{label} must be an object.")
    return cast("dict[str, Any]", value)


def _ensure_string_enum(values: object, *, label: str) -> None:
    if not isinstance(values, list) or not values:
        raise _schema_error(f"{label} must define a non-empty string enum.")
    if not all(isinstance(value, str) for value in values):
        raise _schema_error(f"{label} must define a string enum.")


def _ensure_const_string_options(options: object, *, label: str) -> None:
    if not isinstance(options, list) or not options:
        raise _schema_error(f"{label} must define non-empty string enum options.")
    for option in options:
        option_obj = _ensure_object(option, label=label)
        if not isinstance(option_obj.get("const"), str):
            raise _schema_error(f"{label} must define string enum options.")


def _validate_string_enum_shape(property_schema: dict[str, Any], *, label: str) -> None:
    if "enum" in property_schema:
        _ensure_string_enum(property_schema["enum"], label=label)
    if "oneOf" in property_schema:
        _ensure_const_string_options(property_schema["oneOf"], label=label)


def _validate_array_items(items: object, *, label: str) -> None:
    item_schema = _ensure_object(items, label=f"{label}.items")
    if item_schema.get("type") == "string" and "enum" in item_schema:
        _ensure_string_enum(item_schema["enum"], label=f"{label}.items")
        return
    if "anyOf" in item_schema:
        _ensure_const_string_options(item_schema["anyOf"], label=f"{label}.items")
        return
    raise _schema_error(f"{label} must use string enum array items.")


def _validate_property_schema(name: str, property_schema: object) -> None:
    _reject_sensitive_property_name(name)
    schema = _ensure_object(property_schema, label=name)

    if "properties" in schema:
        raise _schema_error(f"Form mode property `{name}` cannot be nested.")

    property_type = schema.get("type")
    if property_type in _PRIMITIVE_TYPES:
        if property_type == "string":
            _validate_string_enum_shape(schema, label=name)
        return

    if property_type == "array":
        _validate_array_items(schema.get("items"), label=name)
        return

    if "oneOf" in schema:
        _ensure_const_string_options(schema["oneOf"], label=name)
        return

    raise _schema_error(f"Form mode property `{name}` must be a primitive field or string enum.")


def validate_form_requested_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Validate Atlas's restricted form-mode elicitation schema subset."""
    root = _ensure_object(schema, label="requestedSchema")
    if root.get("type") != "object":
        raise _schema_error("requestedSchema.type must be `object`.")

    properties = _ensure_object(root.get("properties"), label="requestedSchema.properties")
    for name, property_schema in properties.items():
        _validate_property_schema(name, property_schema)

    required = root.get("required", [])
    if not isinstance(required, list) or not all(isinstance(field, str) for field in required):
        raise _schema_error("requestedSchema.required must be a list of field names.")

    missing_required = set(required) - set(properties)
    if missing_required:
        fields = ", ".join(sorted(missing_required))
        raise _schema_error(f"requestedSchema.required contains unknown fields: {fields}.")

    return schema


def build_form_elicitation_request(
    *,
    message: str,
    requested_schema: dict[str, Any],
) -> types.ElicitRequest:
    """Build a validated form-mode elicitation/create request."""
    return types.ElicitRequest(
        params=types.ElicitRequestFormParams(
            message=message,
            requestedSchema=validate_form_requested_schema(requested_schema),
        )
    )


def build_url_elicitation_request(
    *,
    message: str,
    url: str,
    elicitation_id: str,
) -> types.ElicitRequest:
    """Build a URL-mode elicitation/create request."""
    return types.ElicitRequest(
        params=types.ElicitRequestURLParams(
            message=message,
            url=url,
            elicitationId=elicitation_id,
        )
    )


def build_url_elicitation_required_error(
    *,
    message: str,
    elicitations: list[types.ElicitRequest],
) -> McpError:
    """Build a JSON-RPC error for requests blocked on URL-mode elicitation."""
    elicitation_payloads: list[dict[str, Any]] = []
    for elicitation in elicitations:
        params = elicitation.params
        if not isinstance(params, types.ElicitRequestURLParams):
            raise TypeError("URLElicitationRequiredError can only include URL elicitations.")
        elicitation_payloads.append(params.model_dump(by_alias=True, exclude_none=True))

    return McpError(
        types.ErrorData(
            code=URL_ELICITATION_REQUIRED,
            message=message,
            data={"elicitations": elicitation_payloads},
        )
    )
