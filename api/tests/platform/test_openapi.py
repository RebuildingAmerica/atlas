"""OpenAPI publishing tests."""

from http import HTTPStatus

import pytest

STATUS_OK = HTTPStatus.OK
MIN_OPERATION_DESCRIPTION_LENGTH = 140
MIN_TAG_DESCRIPTION_LENGTH = 120


@pytest.mark.asyncio
async def test_openapi_and_docs_are_public(test_client: object) -> None:
    """The runtime app should publish the spec and Scalar docs UI."""
    openapi_response = await test_client.get("/openapi.json")
    docs_response = await test_client.get("/docs")

    assert openapi_response.status_code == STATUS_OK
    assert docs_response.status_code == STATUS_OK
    assert "Scalar.createApiReference" in docs_response.text
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
