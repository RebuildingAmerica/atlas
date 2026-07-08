"""OpenAPI metadata and export helpers for the Atlas API."""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from atlas.platform.openapi_guidance import OPENAPI_OPERATION_NOTES, OPENAPI_TAG_OPERATION_GUIDANCE
from atlas.platform.openapi_metadata import (
    OPENAPI_CONTACT,
    OPENAPI_DESCRIPTION,
    OPENAPI_EXTERNAL_DOCS,
    OPENAPI_LICENSE,
    OPENAPI_SERVERS,
    OPENAPI_SUMMARY,
    OPENAPI_TAG_GROUPS,
    OPENAPI_TAGS,
    OPENAPI_TITLE,
    OPENAPI_VERSION,
)
from atlas.platform.openapi_schemas import SCHEMA_DESCRIPTIONS, SCHEMA_PROPERTY_DESCRIPTIONS

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.routing import APIRoute

OpenAPISchema = dict[str, Any]
OpenAPIOperation = dict[str, Any]
SchemaPropertyKey = tuple[str, str]

__all__ = [
    "OPENAPI_CONTACT",
    "OPENAPI_DESCRIPTION",
    "OPENAPI_EXTERNAL_DOCS",
    "OPENAPI_LICENSE",
    "OPENAPI_OPERATION_NOTES",
    "OPENAPI_SERVERS",
    "OPENAPI_SUMMARY",
    "OPENAPI_TAGS",
    "OPENAPI_TAG_GROUPS",
    "OPENAPI_TAG_OPERATION_GUIDANCE",
    "OPENAPI_TITLE",
    "OPENAPI_VERSION",
    "SCHEMA_DESCRIPTIONS",
    "SCHEMA_PROPERTY_DESCRIPTIONS",
    "enrich_openapi_schema",
    "export_openapi_schema",
    "generate_operation_id",
    "install_openapi_enrichment",
    "main",
]

HTTP_METHODS = {"get", "put", "post", "delete", "patch", "options", "head", "trace"}


def generate_operation_id(route: APIRoute) -> str:
    """Generate stable, human-readable operation IDs from route names."""
    return route.name


def install_openapi_enrichment(app: FastAPI) -> None:
    """Install Atlas documentation enrichment on the FastAPI OpenAPI generator."""
    default_openapi = app.openapi

    def enriched_openapi() -> OpenAPISchema:
        """Return the generated OpenAPI schema with Atlas documentation context."""
        if app.openapi_schema:
            return app.openapi_schema

        schema = default_openapi()
        enrich_openapi_schema(schema)
        app.openapi_schema = schema
        return schema

    app.openapi = enriched_openapi  # type: ignore[method-assign]


def enrich_openapi_schema(schema: OpenAPISchema) -> None:
    """Mutate a generated OpenAPI schema with Scalar-friendly explanatory docs."""
    schema["externalDocs"] = OPENAPI_EXTERNAL_DOCS
    schema["x-tagGroups"] = OPENAPI_TAG_GROUPS
    _enrich_operations(schema)
    _enrich_schema_components(schema)


def _enrich_operations(schema: OpenAPISchema) -> None:
    """Add workflow and trust context to every operation description."""
    paths = schema.get("paths")
    if not isinstance(paths, dict):
        return

    for path_item in paths.values():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            _enrich_operation(operation)


def _enrich_operation(operation: OpenAPIOperation) -> None:
    """Append tag-level and operation-specific guidance to one operation."""
    description = str(operation.get("description") or "").strip()
    sections = [description] if description else []

    tags = operation.get("tags")
    tag = tags[0] if isinstance(tags, list) and tags else None
    if isinstance(tag, str):
        _append_unique_section(sections, OPENAPI_TAG_OPERATION_GUIDANCE.get(tag))

    operation_id = operation.get("operationId")
    if isinstance(operation_id, str):
        _append_unique_section(sections, OPENAPI_OPERATION_NOTES.get(operation_id))

    if sections:
        operation["description"] = "\n\n".join(sections)


def _append_unique_section(sections: list[str], section: str | None) -> None:
    """Append a section when it exists and is not already represented."""
    if not section:
        return
    normalized = section.strip()
    if normalized and normalized not in sections:
        sections.append(normalized)


def _enrich_schema_components(schema: OpenAPISchema) -> None:
    """Ensure response and request schemas expose helpful Scalar field descriptions."""
    schemas = schema.get("components", {}).get("schemas")
    if not isinstance(schemas, dict):
        return

    for schema_name, component in schemas.items():
        if not isinstance(component, dict):
            continue
        component.setdefault("description", _fallback_schema_description(str(schema_name)))
        if schema_name in SCHEMA_DESCRIPTIONS:
            component["description"] = SCHEMA_DESCRIPTIONS[str(schema_name)]

        properties = component.get("properties")
        if not isinstance(properties, dict):
            continue

        for property_name, property_schema in properties.items():
            if not isinstance(property_schema, dict):
                continue
            key = (str(schema_name), str(property_name))
            property_schema.setdefault(
                "description",
                SCHEMA_PROPERTY_DESCRIPTIONS.get(
                    key,
                    _fallback_property_description(str(schema_name), str(property_name)),
                ),
            )


def _fallback_schema_description(schema_name: str) -> str:
    """Create a readable schema description when Pydantic did not emit one."""
    label = _humanize_schema_name(schema_name)
    return f"Schema for {label}."


def _fallback_property_description(schema_name: str, property_name: str) -> str:
    """Create a readable property description when a field does not define one."""
    property_label = _humanize_identifier(property_name)
    schema_label = _humanize_schema_name(schema_name)
    return f"{property_label} for this {schema_label}."


def _humanize_schema_name(schema_name: str) -> str:
    """Convert a schema class name into a short human label."""
    stripped = schema_name
    for suffix in ("Response", "Request", "Create", "Update"):
        if stripped.endswith(suffix):
            stripped = stripped.removesuffix(suffix)
    return _humanize_identifier(stripped)


def _humanize_identifier(value: str) -> str:
    """Convert snake_case or PascalCase into lowercase words."""
    words: list[str] = []
    current = ""
    previous = ""

    for char in value.replace("_", " "):
        if char == " ":
            if current:
                words.append(current)
                current = ""
            previous = char
            continue
        if char.isupper() and current and (not previous.isupper()):
            words.append(current)
            current = char.lower()
        else:
            current += char.lower()
        previous = char

    if current:
        words.append(current)

    return " ".join(words)


def export_openapi_schema(app: FastAPI, output_path: Path) -> Path:
    """Export the app OpenAPI schema to a deterministic JSON artifact."""
    app.openapi_schema = None  # Force regeneration
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def main() -> None:
    """CLI entrypoint for exporting the Atlas OpenAPI schema."""
    create_app = importlib.import_module("atlas.main").create_app
    project_root = Path(__file__).resolve().parents[3]
    output_path = project_root / "openapi" / "atlas.openapi.json"
    export_openapi_schema(create_app(), output_path)
    print(output_path)


if __name__ == "__main__":  # pragma: no cover
    main()
