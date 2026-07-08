"""Tests for access helper branches."""
# ruff: noqa

from __future__ import annotations

import pytest

from atlas.domains.access.models.watch_events import (
    OrgChangeEventCRUD,
    OrgChangeEventRecord,
    OrgCoverageStatusChange,
)
from atlas.models import EntryCRUD, SourceCRUD


class TestWatchEvents:
    """Change-event helper branches."""

    @pytest.mark.asyncio
    async def test_record_reuses_existing_source_event(self, test_db: object) -> None:
        """A repeated source-backed change should reuse the existing row."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Neighborhood Legal Center",
            description="Profile for digest coverage.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.test/new-source",
            source_type="news_article",
            extraction_method="manual",
            title="New source",
            publication="Example Civic News",
        )
        first = await OrgChangeEventCRUD.record(
            test_db,
            OrgChangeEventRecord(
                org_id="org-1",
                resource_type="entry",
                resource_id=entry_id,
                event_type="new_source",
                title="New source",
                summary="A new public source was linked.",
                source_id=source_id,
                entry_id=entry_id,
            ),
        )
        second = await OrgChangeEventCRUD.record(
            test_db,
            OrgChangeEventRecord(
                org_id="org-1",
                resource_type="entry",
                resource_id=entry_id,
                event_type="new_source",
                title="New source",
                summary="A new public source was linked.",
                source_id=source_id,
                entry_id=entry_id,
            ),
        )

        assert second.id == first.id

    @pytest.mark.asyncio
    async def test_record_entry_source_events_returns_empty_for_missing_entry(
        self, test_db: object
    ) -> None:
        """Missing watched entries should not create digest rows."""
        assert (
            await OrgChangeEventCRUD.record_entry_source_events(
                test_db,
                entry_id="missing-entry",
                source_id="source-1",
            )
            == []
        )

    @pytest.mark.asyncio
    async def test_record_coverage_status_event_skips_same_status_and_unwatched_targets(
        self, test_db: object
    ) -> None:
        """Unchanged or unwatched coverage updates should not emit events."""
        same_status = await OrgChangeEventCRUD.record_coverage_status_event(
            test_db,
            OrgCoverageStatusChange(
                org_id="org-1",
                target_id="target-1",
                target_name="Tenant Power",
                previous_status="covered",
                new_status="covered",
            ),
        )
        unwatched = await OrgChangeEventCRUD.record_coverage_status_event(
            test_db,
            OrgCoverageStatusChange(
                org_id="org-1",
                target_id="target-1",
                target_name="Tenant Power",
                previous_status="covered",
                new_status="growing",
            ),
        )

        assert same_status is None
        assert unwatched is None
