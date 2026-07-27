"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

import pytest

from tests.support.schema_introspection import table_columns

STATUS_OK = 200


class TestOrgUsageSchema:
    """Schema coverage for workspace renewal usage events."""

    @pytest.mark.asyncio
    async def test_init_db_creates_org_usage_events_table(self, test_db: object) -> None:
        """Fresh databases should include workspace usage events."""
        columns = await table_columns(test_db, "org_usage_events")

        assert {
            "id",
            "org_id",
            "actor_id",
            "event_type",
            "resource_type",
            "resource_id",
            "metadata_json",
            "created_at",
        }.issubset(columns)
