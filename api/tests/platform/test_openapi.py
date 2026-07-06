"""OpenAPI publishing tests."""
# ruff: noqa

from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace

import pytest

from atlas.platform import openapi as openapi_module

STATUS_OK = HTTPStatus.OK
MIN_OPERATION_DESCRIPTION_LENGTH = 140
MIN_TAG_DESCRIPTION_LENGTH = 120


@pytest.mark.asyncio
async def test_openapi_is_public_and_api_docs_ui_is_not_served(test_client: object) -> None:
    """The API publishes the spec; the human reference lives in Mintlify."""
    openapi_response = await test_client.get("/openapi.json")
    docs_response = await test_client.get("/docs")

    assert openapi_response.status_code == STATUS_OK
    assert docs_response.status_code == HTTPStatus.NOT_FOUND
    assert (
        openapi_response.headers["cache-control"]
        == "public, max-age=3600, stale-while-revalidate=86400"
    )


@pytest.mark.asyncio
async def test_openapi_includes_core_contract(test_client: object) -> None:
    """The runtime schema should describe the normalized Atlas API surface."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    assert payload["info"]["title"] == "Atlas REST API"
    assert payload["paths"]["/api/entities"]["get"]["operationId"] == "listEntities"
    assert (
        payload["paths"]["/api/places/{place_key}/profile"]["get"]["operationId"]
        == "getPlaceProfile"
    )
    assert payload["paths"]["/api/discovery-runs"]["post"]["operationId"] == "createDiscoveryRun"
    assert "Address" in payload["components"]["schemas"]
    assert "ContactInfo" in payload["components"]["schemas"]
    assert "FreshnessInfo" in payload["components"]["schemas"]


@pytest.mark.asyncio
async def test_openapi_declares_all_public_route_tags(test_client: object) -> None:
    """The schema should declare every tag used by public routes."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    declared_tags = {tag["name"]: tag for tag in payload["tags"]}
    used_tags = {
        tag
        for path_item in payload["paths"].values()
        for operation in path_item.values()
        for tag in operation.get("tags", [])
    }

    assert used_tags <= set(declared_tags)
    assert all(
        len(tag["description"]) >= MIN_TAG_DESCRIPTION_LENGTH for tag in declared_tags.values()
    )


@pytest.mark.asyncio
async def test_openapi_operation_descriptions_are_explanatory(test_client: object) -> None:
    """Scalar operation descriptions should explain workflow context, not only restate verbs."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    terse_operations = [
        operation["operationId"]
        for path_item in payload["paths"].values()
        for method, operation in path_item.items()
        if method in {"get", "put", "post", "delete", "patch"}
        and len(operation.get("description", "")) < MIN_OPERATION_DESCRIPTION_LENGTH
    ]

    assert terse_operations == []


@pytest.mark.asyncio
async def test_openapi_component_properties_have_descriptions(test_client: object) -> None:
    """Scalar schemas should explain response fields instead of showing bare generated titles."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    missing_descriptions = []
    for schema_name, schema in payload["components"]["schemas"].items():
        for property_name, property_schema in schema.get("properties", {}).items():
            if "description" not in property_schema:
                missing_descriptions.append(f"{schema_name}.{property_name}")

    assert missing_descriptions == []


@pytest.mark.asyncio
async def test_openapi_uses_explicit_metadata_for_health_and_access_routes(
    test_client: object,
) -> None:
    """Health and access routes should expose stable, public-facing metadata."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    health_operation = payload["paths"]["/health"]["get"]
    auth_health_operation = payload["paths"]["/api/auth/health"]["get"]
    verify_discount_operation = payload["paths"]["/api/access/verify-discount"]["post"]
    list_verifications_operation = payload["paths"]["/api/admin/verifications"]["get"]
    update_verification_operation = payload["paths"]["/api/admin/verifications/{user_id}"]["patch"]

    assert health_operation["operationId"] == "getHealth"
    assert health_operation["tags"] == ["health"]
    assert "Returns" not in health_operation["description"]

    assert auth_health_operation["operationId"] == "getAuthHealth"
    assert auth_health_operation["tags"] == ["access"]

    assert verify_discount_operation["operationId"] == "submitDiscountVerification"
    assert verify_discount_operation["tags"] == ["access"]
    assert "Args:" not in verify_discount_operation["description"]

    assert list_verifications_operation["operationId"] == "listVerifications"
    assert list_verifications_operation["tags"] == ["access"]
    assert [parameter["name"] for parameter in list_verifications_operation["parameters"]] == [
        "status",
        "segment",
    ]
    assert "Args:" not in list_verifications_operation["description"]

    assert update_verification_operation["operationId"] == "updateVerification"
    assert update_verification_operation["tags"] == ["access"]
    assert "Args:" not in update_verification_operation["description"]


@pytest.mark.asyncio
async def test_cache_headers_match_resource_type(test_client: object) -> None:
    """Public reads should be cacheable while health remains uncached."""
    domains = await test_client.get("/api/domains")
    entities = await test_client.get("/api/entities")
    health = await test_client.get("/health")

    assert domains.headers["cache-control"] == "public, max-age=3600, stale-while-revalidate=86400"
    assert entities.headers["cache-control"] == "public, max-age=60, stale-while-revalidate=300"
    assert health.headers["cache-control"] == "no-store"


def test_openapi_helper_branches_cover_empty_inputs() -> None:
    """The OpenAPI helper functions should fail closed on empty structures."""
    schema: dict[str, object] = {}
    openapi_module._enrich_operations(schema)  # noqa: SLF001
    openapi_module._enrich_schema_components(schema)  # noqa: SLF001
    assert openapi_module._humanize_identifier("SimpleCase") == "simple case"  # noqa: SLF001
    assert openapi_module._humanize_identifier("snake_case_value") == "snake case value"  # noqa: SLF001


def test_openapi_helper_branches_cover_operation_and_component_enrichment() -> None:
    """Operation and schema enrichment should skip malformed child nodes cleanly."""
    schema = {
        "paths": {
            "/test": {
                "get": "not-a-dict",
                "post": {
                    "description": "Existing.",
                    "tags": ["health"],
                    "operationId": "getHealth",
                },
                "patch": {
                    "description": "",
                    "tags": ["missing-tag"],
                    "operationId": "missing-operation",
                },
            },
            "/ignore": [],
        },
        "components": {
            "schemas": {
                "ExampleResponse": {
                    "properties": {
                        "simple_field": {},
                        "other": "not-a-dict",
                    }
                },
                "Ignored": "not-a-dict",
            }
        },
    }

    openapi_module._enrich_operations(schema)  # noqa: SLF001
    openapi_module._enrich_schema_components(schema)  # noqa: SLF001

    assert schema["paths"]["/test"]["post"]["description"].startswith("Existing.")
    assert (
        schema["components"]["schemas"]["ExampleResponse"]["description"] == "Schema for example."
    )
    assert (
        schema["components"]["schemas"]["ExampleResponse"]["properties"]["simple_field"][
            "description"
        ]
        == "simple field for this example."
    )


def test_openapi_helper_branches_skip_non_string_tags_and_malformed_children() -> None:
    """Malformed OpenAPI child values should be ignored without mutating the payload."""
    operation = {
        "description": "",
        "tags": [123],
        "operationId": 456,
    }
    openapi_module._enrich_operation(operation)  # noqa: SLF001
    assert operation == {
        "description": "",
        "tags": [123],
        "operationId": 456,
    }

    sections = ["Already there"]
    openapi_module._append_unique_section(sections, None)  # noqa: SLF001
    openapi_module._append_unique_section(sections, "   ")  # noqa: SLF001
    openapi_module._append_unique_section(sections, "Already there")  # noqa: SLF001
    assert sections == ["Already there"]

    schema = {
        "components": {
            "schemas": {
                "Ignored": "not-a-dict",
                "ExampleResponse": {
                    "properties": {
                        "simple_field": "not-a-dict",
                    }
                },
            }
        }
    }
    openapi_module._enrich_schema_components(schema)  # noqa: SLF001
    assert (
        schema["components"]["schemas"]["ExampleResponse"]["description"] == "Schema for example."
    )


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", ""),
        ("  ", ""),
        ("snake__case", "snake case"),
    ],
)
def test_openapi_humanize_identifier_handles_empty_and_whitespace_inputs(
    value: str,
    expected: str,
) -> None:
    """Identifier humanization should stay stable for degenerate inputs."""
    assert openapi_module._humanize_identifier(value) == expected  # noqa: SLF001


def test_openapi_helper_branches_cover_cached_schema_and_export_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OpenAPI helpers should honor cached schemas and CLI export wiring."""

    class FakeApp:
        def __init__(self) -> None:
            self.openapi_schema: dict[str, object] | None = None
            self.calls = 0

        def openapi(self) -> dict[str, object]:
            self.calls += 1
            return {"paths": {}}

    route = SimpleNamespace(name="listEntities")
    assert openapi_module.generate_operation_id(route) == "listEntities"

    cached_app = FakeApp()
    openapi_module.install_openapi_enrichment(cached_app)
    cached_app.openapi_schema = {"cached": True}
    assert cached_app.openapi() == {"cached": True}
    assert cached_app.calls == 0

    export_app = FakeApp()
    output_path = tmp_path / "atlas.openapi.json"
    written_path = openapi_module.export_openapi_schema(export_app, output_path)
    assert written_path == output_path
    assert output_path.exists()
    assert '"paths": {}' in output_path.read_text(encoding="utf-8")

    fake_module = SimpleNamespace(create_app=lambda: export_app)
    monkeypatch.setattr(openapi_module.importlib, "import_module", lambda _name: fake_module)

    called: dict[str, Path] = {}

    def fake_export(app: object, path: Path) -> Path:
        called["path"] = path
        return path

    monkeypatch.setattr(openapi_module, "export_openapi_schema", fake_export)
    openapi_module.main()
    assert called["path"].name == "atlas.openapi.json"
