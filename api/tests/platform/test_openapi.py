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
async def test_cache_headers_match_resource_type(test_client: object) -> None:
    """Public reads should be cacheable while health remains uncached."""
    domains = await test_client.get("/api/domains")
    entities = await test_client.get("/api/entities")
    health = await test_client.get("/health")

    assert domains.headers["cache-control"] == "public, max-age=3600, stale-while-revalidate=86400"
    assert entities.headers["cache-control"] == "public, max-age=60, stale-while-revalidate=300"
    assert health.headers["cache-control"] == "no-store"
