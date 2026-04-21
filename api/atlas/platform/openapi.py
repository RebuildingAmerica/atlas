"""OpenAPI metadata and export helpers for the Atlas API."""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.routing import APIRoute

OPENAPI_TITLE = "Atlas REST API"
OPENAPI_SUMMARY = (
    "Structured civic research data for Atlas places, entities, sources, and discovery runs."
)
OPENAPI_DESCRIPTION = (
    "Atlas exposes place-first civic research data through a typed REST API. "
    "The public contract includes entities, sources, issue areas, domains, "
    "place profiles, issue signals, discovery runs, and anonymous data flags."
)
OPENAPI_VERSION = "1.0.0"
OPENAPI_CONTACT = {
    "name": "Rebuilding America",
    "url": "https://atlas.rebuildingus.org",
    "email": "contact@rebuildingus.org",
}
OPENAPI_LICENSE = {
    "name": "MIT",
    "identifier": "MIT",
}
OPENAPI_TAGS = [
    {"name": "entities", "description": "Create, inspect, update, and source Atlas entities."},
    {
        "name": "places",
        "description": "Place-first Atlas resources such as entities, sources, coverage, and profiles.",
    },
    {
        "name": "issue-areas",
        "description": "Atlas issue-area taxonomy resources and natural-language lookup.",
    },
    {"name": "domains", "description": "Top-level Atlas policy and issue domains."},
    {"name": "discovery-runs", "description": "Manage and inspect Atlas discovery pipeline runs."},
    {
        "name": "flags",
        "description": "Anonymous flags for stale or incorrect Atlas entities and sources.",
    },
    {"name": "health", "description": "Operational health and environment metadata."},
]
OPENAPI_SERVERS = [
    {"url": "https://atlas.rebuildingus.org", "description": "Production environment"},
    {"url": "http://api.localhost:1355", "description": "Local development"},
    {"url": "/", "description": "Relative to current host"},
]


def generate_operation_id(route: APIRoute) -> str:
    """Generate stable, human-readable operation IDs from route names."""
    return route.name


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
    project_root = Path(__file__).resolve().parents[2]
    output_path = project_root / "openapi" / "atlas.openapi.json"
    export_openapi_schema(create_app(), output_path)
    print(output_path)
