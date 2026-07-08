"""Tests for org-scoped directory-domain verification endpoints."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from tests.domains.catalog.org_resources_support import (
    ORG_ID,
    OTHER_ORG_ID,
    STATUS_CONFLICT,
    STATUS_CREATED,
    STATUS_FORBIDDEN,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_UNPROCESSABLE_ENTITY,
)


class TestOrgEntriesDirectoryDomain:
    @pytest.mark.asyncio
    async def test_verified_custom_domain_is_exposed_on_public_directory(
        self,
        directory_capable_client: object,
        directory_domain_records: dict[str, set[str]],
    ) -> None:
        """Verified tenant domains should be visible on the public directory trust surface."""
        create_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED
        domain_payload = create_resp.json()
        assert domain_payload["domain"] == "guide.kctenants.org"
        assert domain_payload["status"] == "pending"
        assert domain_payload["verification_host"] == "_atlas-verify.guide.kctenants.org"
        assert domain_payload["verification_token"].startswith("atlas-verify=")

        directory_domain_records["_atlas-verify.guide.kctenants.org"] = {
            domain_payload["verification_token"],
        }

        verify_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain/verification",
        )
        assert verify_resp.status_code == STATUS_OK
        assert verify_resp.json()["status"] == "verified"

        directory_resp = await directory_capable_client.get(
            f"/api/orgs/{ORG_ID}/entries/public-directory"
        )
        assert directory_resp.status_code == STATUS_OK
        payload = directory_resp.json()
        assert payload["workspace"]["custom_domain"] == {
            "domain": "guide.kctenants.org",
            "status": "verified",
        }

    @pytest.mark.asyncio
    async def test_directory_domain_verify_rejects_pasted_token_without_dns_proof(
        self, directory_capable_client: object
    ) -> None:
        """A pasted token is not proof unless the server sees it in DNS."""
        create_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "directory.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED

        verify_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain/verification",
        )

        assert verify_resp.status_code == STATUS_CONFLICT

    @pytest.mark.asyncio
    async def test_directory_domain_put_is_idempotent_for_existing_domain(
        self, directory_capable_client: object
    ) -> None:
        """Repeated PUTs for the same domain should preserve the existing challenge."""
        create_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED
        created_payload = create_resp.json()

        retry_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )

        assert retry_resp.status_code == STATUS_OK
        retry_payload = retry_resp.json()
        assert retry_payload["domain"] == "guide.kctenants.org"
        assert retry_payload["status"] == "pending"
        assert retry_payload["verification_host"] == "_atlas-verify.guide.kctenants.org"
        assert retry_payload["verification_token"] == created_payload["verification_token"]

    @pytest.mark.asyncio
    async def test_directory_domain_put_replaces_existing_domain(
        self, directory_capable_client: object
    ) -> None:
        """PUTting a different domain should replace the singleton domain resource."""
        create_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED
        created_payload = create_resp.json()

        replace_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "directory.kctenants.org"},
        )

        assert replace_resp.status_code == STATUS_OK
        replace_payload = replace_resp.json()
        assert replace_payload["domain"] == "directory.kctenants.org"
        assert replace_payload["status"] == "pending"
        assert replace_payload["verification_host"] == "_atlas-verify.directory.kctenants.org"
        assert replace_payload["verification_token"] != created_payload["verification_token"]

    @pytest.mark.asyncio
    async def test_directory_domain_legacy_verify_action_route_is_not_registered(
        self, directory_capable_client: object
    ) -> None:
        """Domain verification should be exposed as a resource, not an action route."""
        response = await directory_capable_client.post(
            f"/api/orgs/{ORG_ID}/entries/directory-domain/verify",
        )

        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_directory_domain_verifier_queries_challenge_host(
        self,
        directory_capable_client: object,
        directory_domain_records: dict[str, set[str]],
        directory_domain_queries: list[str],
    ) -> None:
        """TXT proof should live at _atlas-verify.<domain>, not the hosted domain."""
        create_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )
        assert create_resp.status_code == STATUS_CREATED
        domain_payload = create_resp.json()
        directory_domain_records["_atlas-verify.guide.kctenants.org"] = {
            domain_payload["verification_token"],
        }

        verify_resp = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain/verification",
        )

        assert verify_resp.status_code == STATUS_OK
        assert directory_domain_queries == ["_atlas-verify.guide.kctenants.org"]

    @pytest.mark.asyncio
    async def test_directory_domain_rejects_malformed_hostnames(
        self, directory_capable_client: object
    ) -> None:
        """Directory domains should be valid bare public hostnames."""
        invalid_domains = [
            "...",
            "foo..example.com",
            "-bad.example.com",
            "bad-.example.com",
            "*.example.com",
            "guide.kctenants.org.",
            "_atlas.example.com",
        ]

        for domain in invalid_domains:
            response = await directory_capable_client.put(
                f"/api/orgs/{ORG_ID}/entries/directory-domain",
                json={"domain": domain},
            )

            assert response.status_code == STATUS_UNPROCESSABLE_ENTITY, domain

    @pytest.mark.asyncio
    async def test_directory_domain_duplicate_returns_conflict(
        self, directory_capable_client: object, test_db: object
    ) -> None:
        """A domain already configured by another workspace should return a clean conflict."""
        await OwnershipCRUD.upsert_directory_domain(
            test_db,
            org_id=OTHER_ORG_ID,
            domain="guide.kctenants.org",
        )

        response = await directory_capable_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )

        assert response.status_code == STATUS_CONFLICT
        assert response.json()["detail"] == "Directory domain is already claimed."

    @pytest.mark.asyncio
    async def test_directory_domain_requires_public_directory_capability(
        self, test_client: object
    ) -> None:
        """Custom directory domains should be reserved for directory-capable packages."""
        response = await test_client.put(
            f"/api/orgs/{ORG_ID}/entries/directory-domain",
            json={"domain": "guide.kctenants.org"},
        )

        assert response.status_code == STATUS_FORBIDDEN
        detail = response.json()["detail"]
        assert detail["error"] == "plan_required"
        assert detail["capability"] == "public.directories"
