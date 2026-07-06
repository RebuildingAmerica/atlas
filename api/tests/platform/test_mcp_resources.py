"""Tests for Atlas data resources exposed through MCP resources/read."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
import pytest_asyncio
from mcp.server.fastmcp import FastMCP

from atlas.models import DiscoveryRunCRUD, SourceCRUD
from atlas.platform.mcp import resources as resources_module
from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.data import AtlasDataService
from atlas.platform.mcp.resources import (
    ATLAS_RESOURCE_TEMPLATE_URIS,
    DISCOVERY_RUN_BRIEF_MIME_TYPE,
    install_data_resources,
)
from atlas.platform.mcp.server import build_mcp
from atlas.platform.mcp.widgets import install_widget_extension

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    import aiosqlite

MAX_LISTED_ATLAS_RESOURCES = 10


@pytest_asyncio.fixture
async def discovery_run_id(test_db: object) -> str:
    """Create a completed discovery run with a source-linked research summary."""
    conn: aiosqlite.Connection = test_db  # type: ignore[assignment]
    run_id = await DiscoveryRunCRUD.create(
        conn,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="interview_leads",
    )
    await DiscoveryRunCRUD.complete(
        conn,
        run_id,
        queries_generated=4,
        sources_fetched=3,
        sources_processed=3,
        entries_extracted=2,
        entries_after_dedup=2,
        entries_confirmed=1,
    )
    await DiscoveryRunCRUD.update_research_summary(
        conn,
        run_id,
        {
            "brief": "One source-backed housing lead in Kansas City.",
            "ranked_leads": [
                {
                    "entry_id": "entry-1",
                    "name": "KC Tenants",
                    "type": "organization",
                    "why_it_matters": "Named in local coverage.",
                    "source_count": 2,
                    "latest_source_date": "2026-04-15",
                }
            ],
            "key_sources": [
                {
                    "source_id": "source-1",
                    "title": "Tenant organizing grows",
                    "url": "https://example.org/housing",
                    "type": "journalism",
                    "why_it_matters": "Names the lead and issue focus.",
                }
            ],
            "gaps": [{"label": "Rural coverage", "detail": "No county lead yet."}],
            "reasoning_signals": ["Ranked 1 lead.", "Flagged 1 gap."],
        },
    )
    return run_id


@pytest_asyncio.fixture
async def _patched_data_service(
    db_url: str, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[None]:
    """Route MCP resource handlers to the fixture database."""
    monkeypatch.setattr(
        server_module,
        "_build_data_service",
        lambda: AtlasDataService(db_url, public_url="https://atlas.example"),
    )
    yield


@pytest.mark.asyncio
async def test_build_mcp_registers_atlas_data_resource_templates() -> None:
    """Atlas advertises templates for durable data resources without listing the catalog."""
    mcp = build_mcp()

    templates = await mcp.list_resource_templates()
    template_uris = {template.uriTemplate for template in templates}

    assert set(ATLAS_RESOURCE_TEMPLATE_URIS) <= template_uris


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_completed_discovery_run_resource_is_readable(
    discovery_run_id: str,
) -> None:
    """The canonical run resource URI returned by tools is readable as JSON."""
    mcp = build_mcp()

    contents = list(await mcp.read_resource(f"atlas://discovery-runs/{discovery_run_id}"))

    assert len(contents) == 1
    assert contents[0].mime_type == "application/json"
    payload = json.loads(contents[0].content)
    assert payload["id"] == discovery_run_id
    assert payload["resource_uri"] == f"atlas://discovery-runs/{discovery_run_id}"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_completed_discovery_run_brief_resource_is_readable_markdown(
    discovery_run_id: str,
) -> None:
    """Run briefs should be compact, human-readable context for MCP clients."""
    mcp = build_mcp()

    contents = list(await mcp.read_resource(f"atlas://discovery-runs/{discovery_run_id}/brief"))

    assert len(contents) == 1
    assert contents[0].mime_type == DISCOVERY_RUN_BRIEF_MIME_TYPE
    assert "# Research brief: Kansas City, MO" in contents[0].content
    assert "One source-backed housing lead in Kansas City." in contents[0].content
    assert "KC Tenants" in contents[0].content
    assert "Rural coverage" in contents[0].content


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_discovery_run_sources_resource_is_readable(discovery_run_id: str) -> None:
    """Run summary sources should be readable as their own resource."""
    mcp = build_mcp()

    contents = list(await mcp.read_resource(f"atlas://discovery-runs/{discovery_run_id}/sources"))

    assert len(contents) == 1
    assert contents[0].mime_type == "application/json"
    payload = json.loads(contents[0].content)
    assert payload["run_id"] == discovery_run_id
    assert payload["sources"][0]["source_id"] == "source-1"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_entity_source_trail_resource_is_readable(
    sample_entry: str, sample_source: str, test_db: object
) -> None:
    """Entity source-trail resource reads reuse the public source filtering contract."""
    await SourceCRUD.link_to_entry(
        test_db,
        sample_entry,
        sample_source,
        extraction_context="Relevant passage here",
    )
    mcp = build_mcp()

    contents = list(await mcp.read_resource(f"atlas://entities/{sample_entry}/sources"))

    assert len(contents) == 1
    assert contents[0].mime_type == "application/json"
    payload = json.loads(contents[0].content)
    assert payload["entity_id"] == sample_entry
    assert payload["sources"]


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_city_coverage_resource_is_readable() -> None:
    """Known place coverage URIs should resolve to the same coverage summary as the tool."""
    mcp = build_mcp()

    contents = list(await mcp.read_resource("atlas://cities/gary-in/coverage"))

    assert len(contents) == 1
    assert contents[0].mime_type == "application/json"
    payload = json.loads(contents[0].content)
    assert payload["resource_uri"] == "atlas://cities/gary-in/coverage"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_state_coverage_resource_is_readable() -> None:
    """State coverage URIs should resolve through the same place coverage service."""
    mcp = build_mcp()

    contents = list(await mcp.read_resource("atlas://states/IN/coverage"))

    assert len(contents) == 1
    assert contents[0].mime_type == "application/json"
    payload = json.loads(contents[0].content)
    assert payload["resource_uri"] == "atlas://states/IN/coverage"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_patched_data_service")
async def test_resources_list_stays_bounded_to_widgets_and_shelf(
    discovery_run_id: str,
) -> None:
    """Listing resources exposes a shelf, not every entity in the catalog."""
    mcp = build_mcp()

    resources = await mcp.list_resources()
    atlas_resource_uris = [
        str(resource.uri) for resource in resources if str(resource.uri).startswith("atlas://")
    ]

    assert f"atlas://discovery-runs/{discovery_run_id}" in atlas_resource_uris
    assert f"atlas://discovery-runs/{discovery_run_id}/brief" in atlas_resource_uris
    assert not any(uri.startswith("atlas://entities/") for uri in atlas_resource_uris)
    assert len(atlas_resource_uris) <= MAX_LISTED_ATLAS_RESOURCES


def test_run_brief_markdown_handles_sparse_summary() -> None:
    """Sparse run summaries should still render a plain, useful brief."""
    markdown = resources_module._run_brief_markdown(  # noqa: SLF001
        {
            "id": "run-1",
            "location_query": None,
            "research_summary": {
                "ranked_leads": [
                    {"entry_id": "entry-1"},
                    {"why_it_matters": "Named in coverage.", "source_count": 0},
                ],
                "key_sources": [{"title": "Untitled note"}, {"url": "https://example.org"}],
                "gaps": [{}],
            },
        }
    )

    assert "# Research brief: run-1" in markdown
    assert "No brief available." in markdown
    assert "**entry-1**: No summary available." in markdown
    assert "**Unknown lead** (0 sources): Named in coverage." in markdown
    assert "- Untitled note" in markdown
    assert "- [https://example.org](https://example.org)" in markdown
    assert "**Coverage gap**: No detail available." in markdown


def test_run_brief_markdown_handles_empty_summary() -> None:
    """Brief rendering should not invent optional sections when summary details are absent."""
    markdown = resources_module._run_brief_markdown(  # noqa: SLF001
        {"id": "run-1", "location_query": "Gary, IN", "research_summary": {}}
    )

    assert markdown == "# Research brief: Gary, IN\n\nNo brief available.\n"


def test_run_summary_sources_handles_missing_summary() -> None:
    """Discovery-run source resources should tolerate runs without summary sources."""
    payload = resources_module._run_summary_sources({"id": "run-1"})  # noqa: SLF001

    assert payload == {
        "run_id": "run-1",
        "resource_uri": "atlas://discovery-runs/run-1/sources",
        "sources": [],
    }


@pytest.mark.asyncio
async def test_invalid_city_coverage_resource_reports_error() -> None:
    """Invalid city resource keys should fail explicitly instead of guessing a place."""
    mcp = build_mcp()

    with pytest.raises(ValueError, match="Invalid city place key"):
        await mcp.read_resource("atlas://cities/notacity/coverage")


@pytest.mark.asyncio
async def test_resource_shelf_failure_preserves_existing_resources() -> None:
    """A shelf query failure must not make existing widget resources disappear."""

    class FailingService:
        async def list_discovery_runs(self, **kwargs: object) -> dict[str, object]:  # noqa: ARG002
            msg = "database unavailable"
            raise RuntimeError(msg)

    mcp = FastMCP("Atlas test")
    install_widget_extension(mcp)
    install_data_resources(mcp, FailingService)

    listed = await mcp.list_resources()
    listed_uris = {str(resource.uri) for resource in listed}

    assert "ui://atlas/entity-card" in listed_uris
    assert not any(uri.startswith("atlas://discovery-runs/") for uri in listed_uris)
