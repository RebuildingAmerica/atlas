"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

import pytest

STATUS_OK = 200


class TestOrgUsageSchema:
    """Schema coverage for workspace renewal usage events."""

    @pytest.mark.asyncio
    async def test_init_db_creates_org_usage_events_table(self, test_db: object) -> None:
        """Fresh databases should include workspace usage events."""
        cursor = await test_db.execute("PRAGMA table_info(org_usage_events)")
        columns = {row[1] for row in await cursor.fetchall()}

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
