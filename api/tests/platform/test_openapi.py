"""OpenAPI publishing tests."""

from http import HTTPStatus

import pytest

STATUS_OK = HTTPStatus.OK


@pytest.mark.asyncio
async def test_openapi_and_docs_are_public(test_client: object) -> None:
    """The runtime app should publish the spec and both docs UIs."""
    openapi_response = await test_client.get("/openapi.json")
    docs_response = await test_client.get("/docs")
    redoc_response = await test_client.get("/redoc")

    assert openapi_response.status_code == STATUS_OK
    assert docs_response.status_code == STATUS_OK
    assert redoc_response.status_code == STATUS_OK
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

    declared_tags = {tag["name"] for tag in payload["tags"]}

    assert {
        "access",
        "claims",
        "discovery-schedules",
        "feed",
        "follows",
        "lists",
        "org-annotations",
        "org-discovery-runs",
        "org-entries",
    }.issubset(declared_tags)


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
