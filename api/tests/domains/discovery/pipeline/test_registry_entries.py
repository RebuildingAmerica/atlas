"""Tests for turning nonprofit-register rows into discovery candidates."""

from __future__ import annotations

import pytest
from atlas_discovery_engine import (
    ProPublicaRegistryProvider,
    RegistryOrganization,
    RegistryProvider,
)

from atlas.domains.discovery.pipeline.registry_entries import (
    build_registry_provider,
    collect_registry_organizations,
    is_registry_corroborated,
    registry_organizations_to_entries,
)


def _org(
    registry_id: str, name: str = "Housing Trust", **overrides: object
) -> RegistryOrganization:
    fields: dict[str, object] = {
        "name": name,
        "city": "Lincoln",
        "state": "NE",
        "registry_id": registry_id,
        "source_url": f"https://example.org/{registry_id}",
        "category_code": "L21",
        "website": None,
    }
    fields.update(overrides)
    return RegistryOrganization(**fields)  # type: ignore[arg-type]


class _RecordingProvider(RegistryProvider):
    """Returns a canned batch per call and records what was asked for."""

    def __init__(self, batches: list[list[RegistryOrganization]]) -> None:
        self._batches = list(batches)
        self.calls: list[tuple[str, str, int]] = []

    async def search_organizations(
        self, term: str, state: str, *, limit: int
    ) -> list[RegistryOrganization]:
        self.calls.append((term, state, limit))
        return self._batches.pop(0) if self._batches else []


class TestCollectRegistryOrganizations:
    @pytest.mark.asyncio
    async def test_deduplicates_organizations_across_terms(self) -> None:
        """The same filer matching two terms is one candidate."""
        provider = _RecordingProvider([[_org("1"), _org("2")], [_org("2"), _org("3")]])

        found = await collect_registry_organizations(
            provider, state="NE", issue_areas=["housing_affordability"], limit=10
        )

        assert [o.registry_id for o in found] == ["1", "2", "3"]

    @pytest.mark.asyncio
    async def test_stops_asking_once_the_limit_is_met(self) -> None:
        """A free public API is not asked for more than the run will use."""
        provider = _RecordingProvider([[_org(str(i)) for i in range(5)]])

        found = await collect_registry_organizations(
            provider, state="NE", issue_areas=["housing_affordability"], limit=5
        )

        assert len(found) == 5
        assert len(provider.calls) == 1

    @pytest.mark.asyncio
    async def test_narrows_each_request_to_what_is_still_needed(self) -> None:
        """Later terms ask only for the remainder of the budget."""
        provider = _RecordingProvider([[_org("1"), _org("2")], [_org("3")]])

        await collect_registry_organizations(
            provider, state="NE", issue_areas=["housing_affordability"], limit=4
        )

        assert [limit for _term, _state, limit in provider.calls][:2] == [4, 2]

    @pytest.mark.asyncio
    async def test_skips_a_row_with_no_registry_identifier(self) -> None:
        """Without an EIN there is nothing to deduplicate a filer on."""
        provider = _RecordingProvider([[_org(""), _org("9")]])

        found = await collect_registry_organizations(
            provider, state="NE", issue_areas=["housing_affordability"], limit=5
        )

        assert [o.registry_id for o in found] == ["9"]

    @pytest.mark.asyncio
    async def test_an_unknown_issue_area_asks_nothing(self) -> None:
        """A slug outside the taxonomy has no terms, so it spends no request."""
        provider = _RecordingProvider([[_org("1")]])

        found = await collect_registry_organizations(
            provider, state="NE", issue_areas=["not_a_real_issue"], limit=5
        )

        assert found == []
        assert provider.calls == []


class TestRegistryOrganizationsToEntries:
    def test_carries_the_register_page_as_the_entry_source(self) -> None:
        """A registry candidate cites where it came from, like any entry."""
        entries = registry_organizations_to_entries(
            [_org("42")], issue_areas=["housing_affordability"], today_iso="2026-09-12"
        )

        assert len(entries) == 1
        entry = entries[0]
        assert entry["name"] == "Housing Trust"
        assert entry["type"] == "organization"
        assert entry["source_urls"] == ["https://example.org/42"]
        assert entry["source_types"] == ["government_record"]
        assert entry["issue_areas"] == ["housing_affordability"]
        assert entry["last_seen"] == "2026-09-12"

    def test_states_what_the_register_actually_asserts(self) -> None:
        """The context claims a filing, not that the work is any good."""
        entries = registry_organizations_to_entries(
            [_org("42")], issue_areas=[], today_iso="2026-09-12"
        )

        context = entries[0]["extraction_context"]
        assert "EIN 42" in context
        assert "Lincoln, NE" in context
        assert "L21" in context

    def test_omits_details_the_register_did_not_publish(self) -> None:
        """A filer with no city or classification still yields a clean sentence."""
        entries = registry_organizations_to_entries(
            [_org("42", city=None, state=None, category_code=None)],
            issue_areas=[],
            today_iso="2026-09-12",
        )

        context = entries[0]["extraction_context"]
        assert context == "Registered nonprofit filing IRS Form 990 under EIN 42."

    def test_drops_a_row_with_no_name(self) -> None:
        """A nameless filer cannot become a catalog record."""
        entries = registry_organizations_to_entries(
            [_org("42", name="")], issue_areas=[], today_iso="2026-09-12"
        )

        assert entries == []


class TestIsRegistryCorroborated:
    def test_a_register_filing_page_corroborates(self) -> None:
        """The EIN page is the authoritative record the trust gate asks for."""
        entries = registry_organizations_to_entries(
            [
                RegistryOrganization(
                    name="Housing Trust",
                    city="Lincoln",
                    state="NE",
                    registry_id="470123456",
                    source_url=f"{ProPublicaRegistryProvider.ORGANIZATION_URL}/470123456",
                )
            ],
            issue_areas=[],
            today_iso="2026-09-12",
        )

        assert is_registry_corroborated(entries[0]["source_urls"]) is True

    def test_an_ordinary_web_source_does_not(self) -> None:
        """A news article about an organization is not a filing."""
        assert is_registry_corroborated(["https://example.org/about-us"]) is False

    def test_a_record_citing_nothing_does_not(self) -> None:
        """An entry with no sources has nothing to corroborate it."""
        assert is_registry_corroborated([]) is False


class TestBuildRegistryProvider:
    def test_no_budget_means_no_register_and_no_network(self) -> None:
        """A run configured for nothing must not reach a public API."""
        assert build_registry_provider(0) is None
        assert build_registry_provider(-1) is None

    def test_a_budget_yields_the_propublica_adapter(self) -> None:
        """Given budget, the register is the IRS index ProPublica publishes."""
        provider = build_registry_provider(25)

        assert isinstance(provider, ProPublicaRegistryProvider)
