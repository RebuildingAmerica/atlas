"""Tests for org access and response conversion helpers."""
# ruff: noqa

from __future__ import annotations

from http import HTTPStatus
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from atlas.domains.discovery import api_org
from atlas.domains.discovery.api_org import _run_to_org_response, _verify_org_access

from tests.domains.discovery.api_org_support import ORG_ID, _make_actor


class TestVerifyOrgAccess:
    """Tests for the _verify_org_access helper."""

    def test_matching_org_id_passes(self) -> None:
        """No exception should be raised when actor.org_id matches path org_id."""
        actor = _make_actor("org_123")
        _verify_org_access(actor, "org_123")

    def test_mismatched_org_id_raises_403(self) -> None:
        """A mismatch between actor and path org_id should raise HTTP 403."""
        actor = _make_actor("org_123")
        with pytest.raises(HTTPException) as exc_info:
            _verify_org_access(actor, "org_456")
        assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
        assert "mismatch" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_db_yields_and_closes_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeConnection:
        def __init__(self) -> None:
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    conn = FakeConnection()

    async def fake_get_db_connection(database_url: str, *, backend: str) -> FakeConnection:
        assert database_url == "sqlite:///atlas.db"
        assert backend == "sqlite"
        return conn

    monkeypatch.setattr(api_org, "get_db_connection", fake_get_db_connection)
    dependency = api_org.get_db(
        SimpleNamespace(database_url="sqlite:///atlas.db", database_backend="sqlite")
    )

    yielded = await anext(dependency)
    assert yielded is conn
    with pytest.raises(StopAsyncIteration):
        await anext(dependency)
    assert conn.closed is True


class TestRunToOrgResponse:
    """Tests for the _run_to_org_response conversion helper."""

    def test_converts_discovery_run_model(self) -> None:
        """A DiscoveryRunModel should convert to an OrgDiscoveryRunResponse."""
        research_summary = {
            "brief": "Three source-backed housing leads in Kansas City.",
            "ranked_leads": [
                {
                    "entry_id": "entry-1",
                    "name": "KC Tenants",
                    "type": "organization",
                    "why_it_matters": "Named by city and community sources.",
                    "source_count": 2,
                    "latest_source_date": "2026-01-01",
                }
            ],
            "key_sources": [
                {
                    "source_id": "source-1",
                    "title": "Tenant meeting agenda",
                    "url": "https://example.test/agenda",
                    "publication": "City Council",
                    "published_date": "2026-01-01",
                    "why_it_matters": "Names the lead and issue.",
                }
            ],
            "gaps": [{"label": "Rural groups", "detail": "No county-level source yet."}],
            "reasoning_signals": ["Two independent sources point to the same actor."],
        }
        run = SimpleNamespace(
            id="run_1",
            location_query="Kansas City, MO",
            state="MO",
            research_goal="interview_leads",
            issue_areas=["housing_affordability"],
            queries_generated=10,
            sources_fetched=5,
            sources_processed=3,
            entries_extracted=2,
            entries_after_dedup=1,
            entries_confirmed=1,
            started_at="2026-01-01T00:00:00Z",
            completed_at="2026-01-01T01:00:00Z",
            status="completed",
            error_message=None,
            created_at="2026-01-01T00:00:00Z",
            research_summary=research_summary,
        )
        response = _run_to_org_response(run, ORG_ID)

        assert response.id == "run_1"
        assert response.org_id == ORG_ID
        assert response.location_query == "Kansas City, MO"
        assert response.research_goal == "interview_leads"
        assert response.status == "completed"
        assert response.issue_areas == ["housing_affordability"]
        assert response.research_summary is not None
        assert response.research_summary.brief == research_summary["brief"]
        assert response.research_summary.ranked_leads[0].name == "KC Tenants"
