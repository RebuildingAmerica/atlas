"""The keyless stage: organizations from the register, people from their returns."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from atlas_discovery_engine import (
    FilingOfficer,
    FilingOfficerProvider,
    OrganizationFiling,
    ProPublicaRegistryProvider,
    RegistryOrganization,
    RegistryProvider,
)
from atlas_shared import SourceType

from atlas.domains.discovery.pipeline import registry_stage
from atlas.domains.discovery.pipeline.registry_stage import discover_from_registry
from atlas.platform.config import Settings

if TYPE_CHECKING:
    from collections.abc import Sequence

ORG_URL = ProPublicaRegistryProvider.ORGANIZATION_URL
RETURN_ID = "202510729349300100"


class _OneOrganization(RegistryProvider):
    async def search_organizations(
        self, _term: str, state: str, *, limit: int
    ) -> list[RegistryOrganization]:
        return [
            RegistryOrganization(
                name="Lincoln Food Bank",
                city="Lincoln",
                state=state,
                registry_id="470123456",
                source_url=f"{ORG_URL}/470123456",
            )
        ][:limit]


class _OneReturn(FilingOfficerProvider):
    async def filings_for(self, eins: Sequence[str]) -> list[OrganizationFiling]:
        return [
            OrganizationFiling(ein, RETURN_ID, (FilingOfficer("Ana Ortiz", "President"),))
            for ein in eins
        ]


@pytest.fixture
def _offline_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        registry_stage, "build_registry_provider", lambda _limit: _OneOrganization()
    )
    monkeypatch.setattr(
        registry_stage,
        "build_filing_provider",
        lambda limit: _OneReturn() if limit > 0 else None,
    )


async def _discover(settings: Settings) -> registry_stage.RegistryDiscovery:
    return await discover_from_registry(
        state="NE", issue_areas=["housing_affordability"], settings=settings, today_iso="2026-09-12"
    )


@pytest.mark.asyncio
async def test_a_run_with_no_register_budget_produces_nothing() -> None:
    """A run configured for nothing stays off the network entirely."""
    result = await _discover(Settings())

    assert result.entries == []
    assert result.sources == []


@pytest.mark.asyncio
@pytest.mark.usefixtures("_offline_providers")
async def test_organizations_alone_cite_the_register_as_a_government_record() -> None:
    """The register page is a federal filing index, not the organization's website."""
    result = await _discover(Settings(discovery_registry_max_organizations=5))

    assert [entry["entry_type"] for entry in result.entries] == ["organization"]
    [source] = result.sources
    assert source.url == f"{ORG_URL}/470123456"
    assert source.source_type == SourceType.GOVERNMENT_RECORD
    assert source.title == "Lincoln Food Bank: IRS Form 990 filings"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_offline_providers")
async def test_people_cite_the_return_that_names_them() -> None:
    """Each officer points at the exact return, recorded as a government record."""
    result = await _discover(
        Settings(discovery_registry_max_organizations=5, discovery_registry_max_people=5)
    )

    assert [entry["entry_type"] for entry in result.entries] == ["organization", "person"]
    return_url = f"{ORG_URL}/470123456/{RETURN_ID}/full"
    assert result.entries[1]["source_urls"] == [return_url]
    by_url = {source.url: source for source in result.sources}
    assert by_url[return_url].source_type == SourceType.GOVERNMENT_RECORD
    assert by_url[return_url].title == f"Lincoln Food Bank: IRS Form 990 return {RETURN_ID}"


@pytest.mark.asyncio
async def test_a_nameless_register_row_yields_no_candidate_and_no_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A filer with no name cannot be listed, so nothing should cite it either."""

    class _Nameless(RegistryProvider):
        async def search_organizations(
            self, _term: str, state: str, *, limit: int
        ) -> list[RegistryOrganization]:
            return [
                RegistryOrganization(
                    name="", city=None, state=state, registry_id="1", source_url=f"{ORG_URL}/1"
                )
            ][:limit]

    monkeypatch.setattr(registry_stage, "build_registry_provider", lambda _limit: _Nameless())

    result = await _discover(Settings(discovery_registry_max_organizations=5))

    assert result.entries == []
    assert result.sources == []
