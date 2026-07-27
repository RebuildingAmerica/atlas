"""Tests for API-triggered discovery execution."""

from __future__ import annotations

import httpx
import pytest

from atlas.models import DiscoveryRunCRUD, EntryCRUD
from atlas.platform.config import Settings

from .support import EXPECTED_ACCEPTED_STATUS


class TestDiscoveryApiIntegration:
    """Tests for API-triggered discovery execution."""

    @pytest.mark.asyncio
    async def test_start_discovery_run_can_execute_inline(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Inline mode should run the pipeline before returning the response."""
        from atlas.main import create_app
        from atlas.platform.config import get_settings

        async def fake_runner(**_kwargs: object) -> None:
            job = _kwargs["job"]
            conn = await _get_db_connection(db_url)
            try:
                run = await DiscoveryRunCRUD.get_by_id(conn, job.run_id)
                assert run is not None
                entry_id = await EntryCRUD.create(
                    conn,
                    entry_type="organization",
                    name="Inline Discovery Result",
                    description="Created during inline execution.",
                    city="Kansas City",
                    state="MO",
                    geo_specificity="local",
                )
                await conn.execute(
                    """
                    INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
                    VALUES (?, ?, datetime('now'))
                    """,
                    (entry_id, "housing_affordability"),
                )
                await conn.commit()
                await DiscoveryRunCRUD.complete(
                    conn, job.run_id, queries_generated=1, entries_confirmed=1
                )
            finally:
                await conn.close()

        monkeypatch.setattr(
            "atlas.domains.discovery.run_creation.run_discovery_pipeline_for_run", fake_runner
        )

        settings = Settings(
            database_url=db_url,
            anthropic_api_key="test-key",
            search_api_key="test-search",
            discovery_inline=True,
            multi_user=False,
        )
        app = create_app()
        app.dependency_overrides[get_settings] = lambda: settings

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/discovery-runs",
                json={
                    "location_query": "Kansas City, MO",
                    "state": "MO",
                    "issue_areas": ["housing_affordability"],
                },
            )

        assert response.status_code == EXPECTED_ACCEPTED_STATUS
        data = response.json()
        assert data["status"] == "completed"
        assert data["entries_confirmed"] == 1


async def _get_db_connection(database_url: str) -> object:
    """Import lazily to avoid cluttering the top-level test dependencies."""
    from atlas.models import get_db_connection

    return await get_db_connection(database_url)
