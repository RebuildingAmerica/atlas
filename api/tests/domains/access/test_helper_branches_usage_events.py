"""Tests for access helper branches."""
# ruff: noqa

from __future__ import annotations

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord


class _EmptyCursor:
    async def fetchall(self) -> list[tuple[object, ...]]:
        return []


class _CapturingConnection:
    def __init__(self) -> None:
        self.sql = ""
        self.parameters: tuple[object, ...] = ()

    async def execute(self, sql: str, parameters: tuple[object, ...] = ()) -> _EmptyCursor:
        self.sql = sql
        self.parameters = parameters
        return _EmptyCursor()


class TestUsageEvents:
    """Workspace usage-event helper branches."""

    @pytest.mark.asyncio
    async def test_list_api_calls_by_org_filters_to_api_call_rows(self, test_db: object) -> None:
        """The integration list should exclude non-api events."""
        api_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="api_call",
                resource_type="api",
                resource_id="/api/public-directories",
                metadata_json='{"surface":"api"}',
            ),
        )
        await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="brief_opened",
                resource_type="brief",
                resource_id="brief-1",
            ),
        )

        rows = await OrgUsageEventCRUD.list_api_calls_by_org(test_db, org_id="org-1")

        assert [row.id for row in rows] == [api_event.id]

    @pytest.mark.asyncio
    async def test_count_integration_calls_by_surface_tracks_latest_seen(
        self, test_db: object
    ) -> None:
        """API and MCP calls should be counted separately with the newest timestamp."""
        api_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="api_call",
                resource_type="api",
                resource_id="/api/public-directories",
                metadata_json='{"surface":"api"}',
            ),
        )
        mcp_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="api_call",
                resource_type="api",
                resource_id="/mcp",
                metadata_json='{"surface":"mcp"}',
            ),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-05T11:00:00+00:00", api_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-05T11:00:00+00:00", mcp_event.id),
        )
        await test_db.commit()

        counts = await OrgUsageEventCRUD.count_integration_calls_by_surface(test_db, org_id="org-1")

        assert counts.total_calls == 2
        assert counts.api_calls == 1
        assert counts.mcp_calls == 1
        assert counts.last_seen_at == "2026-07-05T11:00:00+00:00"

    @pytest.mark.asyncio
    async def test_count_integration_calls_by_surface_parameterizes_json_pattern(self) -> None:
        """Postgres must not parse the JSON LIKE pattern's percent signs as placeholders."""
        conn = _CapturingConnection()

        counts = await OrgUsageEventCRUD.count_integration_calls_by_surface(conn, org_id="org-1")

        assert counts.total_calls == 0
        assert 'LIKE \'%"surface":"mcp"%\'' not in conn.sql
        assert conn.parameters == ('%"surface":"mcp"%', "org-1")
