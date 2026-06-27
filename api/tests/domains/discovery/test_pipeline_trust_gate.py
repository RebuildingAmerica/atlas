"""Discovery trust-gate and geocoding tests."""

from __future__ import annotations

import importlib
import importlib.util

import pytest
from atlas_shared import RawEntry

from atlas.domains.discovery.pipeline.runner import (
    DiscoveryPipelineCredentials,
    DiscoveryPipelineJob,
)
from atlas.domains.discovery.pipeline.source_fetcher import FetchedSource
from atlas.models import DiscoveryRunCRUD, EntryCRUD

# Kansas City, MO city centroid from the bundled gazetteer.
_KC_LAT = 39.1
_KC_LNG = -94.58
# A pre-existing rooftop point the backfill/rediscovery must never clobber.
_ROOFTOP_LAT = 39.05
_ROOFTOP_LNG = -94.6


def _load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")


def _make_deduped_entry(
    *,
    entry_type: str,
    name: str,
    city: str,
    state: str,
) -> object:
    """Build a minimal shared deduplicated entry for trust-gate tests."""
    from atlas_shared import DeduplicatedEntry as SharedDeduplicatedEntry

    return SharedDeduplicatedEntry(
        name=name,
        entry_type=entry_type,
        description=f"{name} works on local issues.",
        city=city,
        state=state,
        geo_specificity="local",
        issue_areas=["housing_affordability"],
        source_urls=[],
    )


class TestTrustGateUpsert:
    """The upsert path must hold risky discoveries instead of publishing them."""

    @pytest.mark.asyncio
    async def test_discovered_person_is_held_not_published(self, test_db: object) -> None:
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()
        entry = _make_deduped_entry(
            entry_type="person", name="Sam Organizer", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert stored is not None
        assert stored.active is False
        assert [item.entity_id for item in pending] == [entity_id]
        assert pending[0].hold_reason == "person_requires_review"

    @pytest.mark.asyncio
    async def test_uncorroborated_org_is_held_not_published(self, test_db: object) -> None:
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()
        entry = _make_deduped_entry(
            entry_type="organization", name="Held Collective", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert stored is not None
        assert stored.active is False
        assert [item.entity_id for item in pending] == [entity_id]
        assert pending[0].hold_reason == "uncorroborated_web_only"

    @pytest.mark.asyncio
    async def test_publish_decision_creates_active_entry_without_queueing(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When the gate clears a new record, it is published and never enqueued."""
        from atlas.domains.discovery import trust_gate
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()

        def fake_evaluate(**_kwargs: object) -> trust_gate.GateDecision:
            return trust_gate.GateDecision(publish=True, hold_reason=None)

        monkeypatch.setattr(runner_module, "evaluate_publication", fake_evaluate)
        entry = _make_deduped_entry(
            entry_type="organization", name="Cleared Org", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert stored is not None
        assert stored.active is True
        assert pending == []

    @pytest.mark.asyncio
    async def test_dedup_flagged_discovery_is_held_as_suspect(
        self,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A dedup-flagged record is held with the dedup reason and the flag note."""
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()

        async def fake_fetch_sources(
            queries: list[object],
            _api_key: str | None = None,
        ) -> list[FetchedSource]:
            assert queries
            return [
                FetchedSource(
                    url="https://example.com/collective",
                    title="Collective",
                    publication="KCUR",
                    published_date="2026-02-01",
                    content="Collective content",
                    source_type="news_article",
                )
            ]

        async def fake_extract_entries(
            _url: str,
            _content: str,
            _city: str,
            _state: str,
            _api_key: str | None = None,
        ) -> list[RawEntry]:
            return [
                RawEntry(
                    name="Prairie Collective",
                    entry_type="organization",
                    description="A collective in Kansas City.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["housing_affordability"],
                    extraction_context="A collective in Kansas City.",
                ),
                RawEntry(
                    name="Prairie Collective",
                    entry_type="organization",
                    description="A collective in Springfield.",
                    city="Springfield",
                    state="MO",
                    geo_specificity="local",
                    issue_areas=["housing_affordability"],
                    extraction_context="A collective in Springfield.",
                ),
            ]

        monkeypatch.setattr(runner_module, "fetch_sources", fake_fetch_sources)
        monkeypatch.setattr(runner_module, "extract_entries", fake_extract_entries)

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Kansas City, MO",
            state="MO",
            issue_areas=["housing_affordability"],
        )

        await runner_module.run_discovery_pipeline(
            test_db,
            job=DiscoveryPipelineJob(
                run_id=run_id,
                location_query="Kansas City, MO",
                state="MO",
                issue_areas=["housing_affordability"],
            ),
            credentials=DiscoveryPipelineCredentials(
                search_api_key="test-search-key",
                anthropic_api_key="test-anthropic-key",
            ),
        )

        pending = await ReviewQueueCRUD.list_pending(test_db)
        suspect = next(item for item in pending if item.dedup_suspect)
        assert suspect.hold_reason == "dedup_suspect"
        assert suspect.dedup_note == "similar_name_same_city"

    @pytest.mark.asyncio
    async def test_already_active_match_is_not_unpublished(self, test_db: object) -> None:
        from atlas.domains.moderation.review_queue import ReviewQueueCRUD

        runner_module = _load_runner_module()
        existing_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Live Org",
            description="Already published.",
            city="KC",
            state="MO",
            geo_specificity="local",
        )
        entry = _make_deduped_entry(
            entry_type="organization", name="Live Org", city="KC", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        pending = await ReviewQueueCRUD.list_pending(test_db)
        assert entity_id == existing_id
        assert stored is not None
        assert stored.active is True
        assert pending == []


class TestDiscoveryGeocoding:
    """Discovered actors are placed on the map the moment they are created."""

    @staticmethod
    def _publish(runner_module: object, monkeypatch: pytest.MonkeyPatch) -> None:
        from atlas.domains.discovery import trust_gate

        def fake_evaluate(**_kwargs: object) -> trust_gate.GateDecision:
            return trust_gate.GateDecision(publish=True, hold_reason=None)

        monkeypatch.setattr(runner_module, "evaluate_publication", fake_evaluate)

    @pytest.mark.asyncio
    async def test_new_entry_is_geocoded_offline_on_create(
        self, test_db: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        runner_module = _load_runner_module()
        self._publish(runner_module, monkeypatch)
        entry = _make_deduped_entry(
            entry_type="organization", name="Placed Org", city="Kansas City", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        assert stored is not None
        assert stored.latitude == _KC_LAT
        assert stored.longitude == _KC_LNG
        assert stored.geocode_precision == "city"
        assert stored.geocode_source == "gazetteer"

    @pytest.mark.asyncio
    async def test_unplaceable_new_entry_has_no_coordinates(
        self, test_db: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        runner_module = _load_runner_module()
        self._publish(runner_module, monkeypatch)
        entry = _make_deduped_entry(
            entry_type="organization", name="Nowhere Org", city="Nowhere", state="ZZ"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        assert stored is not None
        assert stored.latitude is None
        assert stored.longitude is None
        assert stored.geocode_precision is None
        assert stored.geocode_source is None

    @pytest.mark.asyncio
    async def test_rediscovery_does_not_clobber_existing_coordinates(self, test_db: object) -> None:
        runner_module = _load_runner_module()
        existing_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Rooftop Org",
            description="Already precisely placed.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            latitude=_ROOFTOP_LAT,
            longitude=_ROOFTOP_LNG,
            geocode_precision="rooftop",
            geocode_source="census",
        )
        entry = _make_deduped_entry(
            entry_type="organization", name="Rooftop Org", city="Kansas City", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        assert entity_id == existing_id
        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        assert stored is not None
        assert stored.latitude == _ROOFTOP_LAT
        assert stored.longitude == _ROOFTOP_LNG
        assert stored.geocode_precision == "rooftop"
        assert stored.geocode_source == "census"

    @pytest.mark.asyncio
    async def test_rediscovery_fills_missing_coordinates(self, test_db: object) -> None:
        runner_module = _load_runner_module()
        existing_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Unplaced Org",
            description="Never geocoded.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        entry = _make_deduped_entry(
            entry_type="organization", name="Unplaced Org", city="Kansas City", state="MO"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        assert entity_id == existing_id
        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        assert stored is not None
        assert stored.latitude == _KC_LAT
        assert stored.longitude == _KC_LNG
        assert stored.geocode_precision == "city"
        assert stored.geocode_source == "gazetteer"

    @pytest.mark.asyncio
    async def test_rediscovery_of_unplaceable_entry_stays_unplaced(self, test_db: object) -> None:
        runner_module = _load_runner_module()
        existing_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Stateless Org",
            description="No resolvable place.",
            city="Nowhere",
            state="ZZ",
            geo_specificity="local",
        )
        entry = _make_deduped_entry(
            entry_type="organization", name="Stateless Org", city="Nowhere", state="ZZ"
        )

        entity_id = await runner_module._upsert_entry(test_db, entry)  # noqa: SLF001

        assert entity_id == existing_id
        stored = await EntryCRUD.get_by_id(test_db, entity_id)
        assert stored is not None
        assert stored.latitude is None
        assert stored.longitude is None
