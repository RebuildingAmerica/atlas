"""The register contributing candidates to a pipeline run."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from atlas_discovery_engine import RegistryOrganization, RegistryProvider

from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.domains.discovery.pipeline import runner as runner_module
from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.models import EntryCRUD
from atlas.platform.config import Settings

if TYPE_CHECKING:
    from atlas_shared import RawEntry


class _OneOrganization(RegistryProvider):
    """Stands in for the IRS index so the test reaches no network."""

    async def search_organizations(
        self, _term: str, state: str, *, limit: int
    ) -> list[RegistryOrganization]:
        return [
            RegistryOrganization(
                name="Lincoln Affordable Housing Trust",
                city="Lincoln",
                state=state,
                registry_id="470123456",
                source_url="https://projects.propublica.org/nonprofits/organizations/470123456",
                category_code="L21",
            )
        ][:limit]


class TestRegistryAsADiscoverySource:
    @pytest.mark.asyncio
    async def test_a_run_keeps_an_organization_search_never_saw(
        self, test_db: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The register carries a run on its own when search returns nothing.

        This is the case the register exists for: the search vendor answers
        402 and finds nothing, and a run still produces a sourced record.
        """

        async def no_sources(*_args: object, **_kwargs: object) -> list[object]:
            return []

        async def no_extraction(*_args: object, **_kwargs: object) -> list[RawEntry]:
            return []

        monkeypatch.setattr(runner_module, "fetch_sources", no_sources)
        monkeypatch.setattr(runner_module, "extract_entries", no_extraction)
        monkeypatch.setattr(
            runner_module, "build_registry_provider", lambda _limit: _OneOrganization()
        )

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Lincoln, NE",
            state="NE",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Lincoln, NE",
                state="NE",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(anthropic_api_key="test-anthropic-key"),
            settings=Settings(discovery_registry_max_organizations=5),
        )

        entries = await EntryCRUD.list(test_db, state="NE", active_only=False, limit=50)
        names = [entry.name for entry in entries]
        assert "Lincoln Affordable Housing Trust" in names

    @pytest.mark.asyncio
    async def test_a_run_with_no_register_budget_asks_nothing(
        self, test_db: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Off by default means a run configured for nothing stays offline."""
        asked = False

        def spy(limit: int) -> None:
            nonlocal asked
            asked = True
            assert limit == 0

        async def no_sources(*_args: object, **_kwargs: object) -> list[object]:
            return []

        monkeypatch.setattr(runner_module, "fetch_sources", no_sources)
        monkeypatch.setattr(runner_module, "build_registry_provider", spy)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Lincoln, NE",
            state="NE",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Lincoln, NE",
                state="NE",
                issue_areas=["housing_affordability"],
            ),
            settings=Settings(),
        )

        assert asked is True
        entries = await EntryCRUD.list(test_db, state="NE", active_only=False, limit=50)
        assert entries == []
