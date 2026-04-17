"""Tests for the Atlas MCP place-first data layer."""

import json
from datetime import date

import pytest
from hypothesis import given
from mcp import types as mcp_types

from atlas.models import EntryCRUD, FlagCRUD, SourceCRUD
from atlas.platform.mcp import server as mcp_server_module
from atlas.platform.mcp.data import AtlasDataService, normalize_place_key
from atlas.platform.mcp.server import build_mcp_server
from tests.support.hypothesis_strategies import (
    city_state_place_keys,
    state_abbreviations,
)

EXPECTED_ENVIRONMENTAL_ENTITY_COUNT = 2


@pytest.fixture
def sample_place() -> str:
    """Canonical place string used across MCP tests."""
    return "Kansas City, MO"


@given(state_abbreviations())
def test_state_abbreviation_place_keys_normalize_to_state_records(state: str) -> None:
    """Two-letter state keys should normalize into canonical Atlas state records."""
    normalized = normalize_place_key(state.lower())

    assert normalized["city"] is None
    assert normalized["state"] == state
    assert normalized["display"] == state


@given(city_state_place_keys())
def test_city_state_place_keys_normalize_to_canonical_records(
    place: tuple[str, str, str],
) -> None:
    """City-state place keys should normalize into canonical Atlas place records."""
    raw_place_key, expected_city, expected_state = place
    normalized = normalize_place_key(raw_place_key)

    assert normalized["city"] == expected_city
    assert normalized["state"] == expected_state
    assert normalized["display"] == f"{expected_city}, {expected_state}"


@pytest.mark.asyncio
async def test_search_entities_returns_agent_facing_records(
    test_db: object,
    db_url: str,
    sample_place: str,
) -> None:
    """Search results should expose compact entity records for agents."""

    org_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="KC Tenants Union",
        description="Tenant organizing network supporting renters in Kansas City.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        website="https://tenants.example.org",
        email="hello@tenants.example.org",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (org_id, "housing_affordability"),
    )

    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/tenants",
        source_type="news_article",
        extraction_method="manual",
        title="Kansas City tenants are organizing block by block",
        publication="Metro News",
        published_date=date(2026, 1, 15),
    )
    await SourceCRUD.link_to_entry(
        test_db,
        entry_id=org_id,
        source_id=source_id,
        extraction_context="KC Tenants Union has organized renters across the city.",
    )

    service = AtlasDataService(db_url)
    result = await service.search_entities(
        place=sample_place,
        issue_areas=["housing_affordability"],
        entity_types=["organization"],
    )

    assert result["items"][0]["id"] == org_id
    assert result["items"][0]["source_count"] == 1
    assert result["items"][0]["resource_uri"] == f"atlas://entities/{org_id}"
    assert result["items"][0]["issue_area_ids"] == ["housing_affordability"]
    assert result["items"][0]["address"]["city"] == "Kansas City"
    assert result["items"][0]["contact"]["website"] == "https://tenants.example.org"
    assert result["items"][0]["freshness"]["staleness_status"] in {
        "fresh",
        "aging",
        "stale",
        "unknown",
    }
    assert result["items"][0]["flag_summary"]["flag_count"] == 0


@pytest.mark.asyncio
async def test_get_entity_sources_returns_provenance(
    test_db: object,
    db_url: str,
) -> None:
    """Agents should be able to retrieve supporting sources for an entity."""

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Maya Carter",
        description="Transit organizer advocating for better bus service.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/transit",
        source_type="news_article",
        extraction_method="manual",
        title="Organizer pushes KC bus reforms",
        publication="City Desk",
        published_date=date(2026, 2, 2),
    )
    await SourceCRUD.link_to_entry(
        test_db,
        entry_id=actor_id,
        source_id=source_id,
        extraction_context="Maya Carter has been leading bus rider meetings in Kansas City.",
    )

    service = AtlasDataService(db_url)
    result = await service.get_entity_sources(actor_id)

    assert result["entity_id"] == actor_id
    assert result["sources"][0]["id"] == source_id
    assert "bus rider meetings" in result["sources"][0]["extraction_context"]
    assert result["sources"][0]["freshness"]["staleness_status"] in {
        "fresh",
        "aging",
        "stale",
        "unknown",
    }
    assert result["sources"][0]["flag_summary"]["flag_count"] == 0


@pytest.mark.asyncio
async def test_resolve_issue_areas_matches_plain_language(db_url: str) -> None:
    """Free-text topic matching should resolve Atlas issue areas."""

    service = AtlasDataService(db_url)
    result = await service.resolve_issue_areas("tenant organizing and public transit")

    slugs = [item["slug"] for item in result["items"][:5]]
    assert "housing_affordability" in slugs
    assert "transportation_and_mobility" in slugs


@pytest.mark.asyncio
async def test_get_place_coverage_returns_counts_and_gaps(
    test_db: object,
    db_url: str,
    sample_place: str,
) -> None:
    """Coverage should stay structured and deterministic."""

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Clean Air KC",
        description="Environmental justice network monitoring industrial pollution.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (actor_id, "environmental_justice_and_pollution"),
    )
    await test_db.commit()

    service = AtlasDataService(db_url)
    result = await service.get_place_coverage(sample_place)

    assert result["place"]["city"] == "Kansas City"
    assert result["place"]["state"] == "MO"
    assert result["entity_count"] == 1
    assert "environmental_justice_and_pollution" in result["covered_issue_area_ids"]
    assert "housing_affordability" in result["missing_issue_area_ids"]


@pytest.mark.asyncio
async def test_get_related_entities_derives_relationships(
    test_db: object,
    db_url: str,
) -> None:
    """Relationships should be mechanically derived from Atlas data."""

    org_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Prairie Workers Cooperative",
        description="Worker-owned co-op in Kansas City.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    person_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Maria Gonzalez",
        description="Founder of Prairie Workers Cooperative.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        affiliated_org_id=org_id,
    )
    await test_db.executemany(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        [
            (org_id, "worker_cooperatives"),
            (person_id, "worker_cooperatives"),
        ],
    )
    await test_db.commit()

    service = AtlasDataService(db_url)
    result = await service.get_related_entities(person_id)

    related_ids = [item["entity"]["id"] for item in result["items"]]
    relation_types = {
        relation["type"] for item in result["items"] for relation in item["relationships"]
    }

    assert org_id in related_ids
    assert "affiliated_organization" in relation_types
    assert "shared_issue_area" in relation_types


@pytest.mark.asyncio
async def test_build_server_exposes_semantic_tools(db_url: str) -> None:
    """The MCP server should register the Atlas semantic tool surface."""

    server = build_mcp_server(database_url=db_url)
    tool_names = sorted(tool.name for tool in await server.list_tools())

    assert tool_names == [
        "flag_entity",
        "flag_source",
        "get_entity",
        "get_entity_sources",
        "get_place_coverage",
        "get_place_entities",
        "get_place_issue_signals",
        "get_place_profile",
        "get_related_entities",
        "resolve_issue_areas",
        "search_entities",
        "search_sources",
    ]


@pytest.mark.asyncio
async def test_search_sources_returns_linked_entity_ids(
    test_db: object,
    db_url: str,
) -> None:
    """Source search should expose linked entities for agent follow-up."""

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="KC Bus Riders",
        description="Transit riders organizing for better service.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (actor_id, "transportation_and_mobility"),
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/bus-riders",
        source_type="news_article",
        extraction_method="manual",
        title="Bus riders demand more reliable service",
        publication="Transit Weekly",
        published_date=date(2026, 2, 14),
    )
    await SourceCRUD.link_to_entry(
        test_db, actor_id, source_id, "The KC Bus Riders coalition packed the hearing."
    )

    service = AtlasDataService(db_url)
    result = await service.search_sources(
        place={"city": "Kansas City", "state": "MO"},
        issue_areas=["transportation_and_mobility"],
        text="reliable service",
    )

    assert result["items"][0]["id"] == source_id
    assert actor_id in result["items"][0]["linked_entity_ids"]
    assert result["place"]["display"] == "Kansas City, MO"


@pytest.mark.asyncio
async def test_get_entity_missing_raises_value_error(db_url: str) -> None:
    """Missing entity lookups should fail cleanly."""

    service = AtlasDataService(db_url)

    with pytest.raises(ValueError, match="Entity not found"):
        await service.get_entity("missing-entity")


@pytest.mark.asyncio
async def test_get_place_issue_signals_groups_entities_by_issue(
    test_db: object,
    db_url: str,
) -> None:
    """Place issue signals should tell an agent which issues are represented locally."""

    org_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Delta Water Watch",
        description="Environmental justice coalition in Stockton.",
        city="Stockton",
        state="CA",
        geo_specificity="local",
    )
    person_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Ana Ruiz",
        description="Organizer working on safe drinking water in Stockton.",
        city="Stockton",
        state="CA",
        geo_specificity="local",
    )
    await test_db.executemany(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        [
            (org_id, "environmental_justice_and_pollution"),
            (person_id, "water_access_and_infrastructure"),
            (person_id, "environmental_justice_and_pollution"),
        ],
    )
    await test_db.commit()

    service = AtlasDataService(db_url)
    result = await service.get_place_issue_signals("Stockton, CA")

    issue_ids = [item["issue_area_id"] for item in result["issues"]]
    assert "environmental_justice_and_pollution" in issue_ids
    env_signal = next(
        item
        for item in result["issues"]
        if item["issue_area_id"] == "environmental_justice_and_pollution"
    )
    assert env_signal["entity_count"] == EXPECTED_ENVIRONMENTAL_ENTITY_COUNT
    assert {item["type"] for item in env_signal["top_entities"]} == {"organization", "person"}


@pytest.mark.asyncio
async def test_get_place_profile_returns_structured_city_context(db_url: str) -> None:
    """Place profiles should expose demographic and socioeconomic context."""

    service = AtlasDataService(db_url)
    profile = await service.get_place_profile("Gary, Indiana")

    assert profile["place"]["city"] == "Gary"
    assert profile["place"]["state"] == "IN"
    assert profile["demographics"]["population"] > 0
    assert "median_household_income" in profile["economics"]
    assert profile["resource_uri"] == "atlas://cities/gary-in/profile"


@pytest.mark.asyncio
async def test_server_tools_and_resources_execute(
    test_db: object,
    db_url: str,
) -> None:
    """The MCP wrapper should execute tools and resources over Atlas data."""

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Prairie Health Collective",
        description="Community clinic network working on public health access.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        website="https://health.example.org",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (actor_id, "community_health_infrastructure"),
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/public-health",
        source_type="report",
        extraction_method="manual",
        title="Clinic network expands in Kansas City",
        publication="Civic Report",
        published_date=date(2026, 3, 1),
    )
    await SourceCRUD.link_to_entry(
        test_db,
        actor_id,
        source_id,
        "Prairie Health Collective opened two new neighborhood clinics.",
    )

    server = build_mcp_server(database_url=db_url)

    actor_tool = await server.call_tool("get_entity", {"entity_id": actor_id})
    actor_payload = actor_tool[1]
    assert actor_payload["id"] == actor_id

    source_tool = await server.call_tool(
        "search_sources",
        {"request": {"text": "Clinic", "limit": 10}},
    )
    source_payload = source_tool[1]
    assert source_payload["items"][0]["id"] == source_id
    assert source_payload["items"][0]["freshness"]["staleness_status"] in {
        "fresh",
        "aging",
        "stale",
        "unknown",
    }

    signals_tool = await server.call_tool("get_place_issue_signals", {"place": "Kansas City, MO"})
    assert signals_tool[1]["issues"]

    actor_resource = await server.read_resource(f"atlas://entities/{actor_id}")
    actor_resource_payload = json.loads(actor_resource[0].content)
    assert actor_resource_payload["id"] == actor_id

    source_resource = await server.read_resource(f"atlas://sources/{source_id}")
    source_resource_payload = json.loads(source_resource[0].content)
    assert source_resource_payload["id"] == source_id


@pytest.mark.asyncio
async def test_taxonomy_and_place_resources_are_readable(
    test_db: object,
    db_url: str,
) -> None:
    """Static taxonomy and computed place resources should be exposed."""

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="KC Digital Commons",
        description="Community broadband advocacy coalition.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (actor_id, "broadband_access_and_digital_divide"),
    )
    await test_db.commit()

    server = build_mcp_server(database_url=db_url)

    issue_resource = await server.read_resource(
        "atlas://issues/broadband_access_and_digital_divide"
    )
    issue_payload = json.loads(issue_resource[0].content)
    assert issue_payload["slug"] == "broadband_access_and_digital_divide"

    domain_resource = await server.read_resource("atlas://issues/technology-and-information")
    domain_payload = json.loads(domain_resource[0].content)
    issue_slugs = {item["slug"] for item in domain_payload["issues"]}
    assert "broadband_access_and_digital_divide" in issue_slugs

    coverage_resource = await server.read_resource("atlas://cities/kansas-city-mo/coverage")
    coverage_payload = json.loads(coverage_resource[0].content)
    assert coverage_payload["entity_count"] == 1
    assert "broadband_access_and_digital_divide" in coverage_payload["covered_issue_area_ids"]

    profile_resource = await server.read_resource("atlas://cities/gary-in/profile")
    profile_payload = json.loads(profile_resource[0].content)
    assert profile_payload["place"]["city"] == "Gary"


@pytest.mark.asyncio
async def test_additional_mcp_tools_and_place_resources_execute(
    test_db: object,
    db_url: str,
) -> None:
    """The remaining MCP tools and place resources should execute against live Atlas data."""
    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Regional Transit Alliance",
        description="Regional transit coalition in Kansas City.",
        city="Kansas City",
        state="MO",
        region="Midwest",
        geo_specificity="regional",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (actor_id, "transportation_and_mobility"),
    )
    await test_db.commit()

    server = build_mcp_server(database_url=db_url)

    search_entities_tool = await server.call_tool(
        "search_entities",
        {"request": {"place": "Kansas City, MO", "limit": 10}},
    )
    assert any(item["id"] == actor_id for item in search_entities_tool[1]["items"])

    place_entities_tool = await server.call_tool(
        "get_place_entities",
        {"request": {"place": {"city": "Kansas City", "state": "MO"}, "limit": 10}},
    )
    assert any(item["id"] == actor_id for item in place_entities_tool[1]["items"])

    place_profile_tool = await server.call_tool("get_place_profile", {"place": "Gary, IN"})
    assert place_profile_tool[1]["place"]["city"] == "Gary"

    signals_resource = await server.read_resource("atlas://cities/kansas-city-mo/issue-signals")
    signals_payload = json.loads(signals_resource[0].content)
    assert signals_payload["place"]["state"] == "MO"


def test_main_runs_stdio_server(monkeypatch: pytest.MonkeyPatch) -> None:
    """The entrypoint should run the server over stdio."""

    class FakeServer:
        def __init__(self) -> None:
            self.transport: str | None = None

        def run(self, *, transport: str) -> None:
            self.transport = transport

    fake_server = FakeServer()
    monkeypatch.setattr(mcp_server_module, "build_mcp_server", lambda: fake_server)

    mcp_server_module.main()

    assert fake_server.transport == "stdio"


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_investigate_place_prompt_contains_tool_references(db_url: str) -> None:
    """The investigate_place prompt should reference key Atlas tools."""

    server = build_mcp_server(database_url=db_url)

    result = await server.get_prompt("investigate_place", {"place": "Kansas City, MO"})
    text = result.messages[0].content.text

    assert len(text) > 0
    assert "get_place_profile" in text
    assert "get_place_coverage" in text
    assert "search_entities" in text
    assert "Kansas City, MO" in text


@pytest.mark.asyncio
async def test_investigate_place_prompt_with_issue_area(db_url: str) -> None:
    """The investigate_place prompt should include issue area focus when provided."""

    server = build_mcp_server(database_url=db_url)

    result = await server.get_prompt(
        "investigate_place",
        {"place": "Gary, IN", "issue_area": "housing_affordability"},
    )
    text = result.messages[0].content.text

    assert "housing_affordability" in text
    assert "Gary, IN" in text


@pytest.mark.asyncio
async def test_assess_coverage_gaps_prompt_contains_tool_references(db_url: str) -> None:
    """The assess_coverage_gaps prompt should reference issue discovery and coverage tools."""

    server = build_mcp_server(database_url=db_url)

    result = await server.get_prompt("assess_coverage_gaps", {"place": "Detroit, MI"})
    text = result.messages[0].content.text

    assert len(text) > 0
    assert "resolve_issue_areas" in text
    assert "get_place_coverage" in text
    assert "get_place_issue_signals" in text
    assert "Detroit, MI" in text


@pytest.mark.asyncio
async def test_compare_places_prompt_contains_both_places(db_url: str) -> None:
    """The compare_places prompt should reference both places and comparison tools."""

    server = build_mcp_server(database_url=db_url)

    result = await server.get_prompt(
        "compare_places",
        {"place_a": "Kansas City, MO", "place_b": "Gary, IN"},
    )
    text = result.messages[0].content.text

    assert len(text) > 0
    assert "Kansas City, MO" in text
    assert "Gary, IN" in text
    assert "get_place_profile" in text
    assert "get_place_coverage" in text


@pytest.mark.asyncio
async def test_compare_places_prompt_with_issue_area(db_url: str) -> None:
    """The compare_places prompt should include issue area focus when provided."""

    server = build_mcp_server(database_url=db_url)

    result = await server.get_prompt(
        "compare_places",
        {
            "place_a": "Denver, CO",
            "place_b": "Stockton, CA",
            "issue_area": "transportation_and_mobility",
        },
    )
    text = result.messages[0].content.text

    assert "transportation_and_mobility" in text


@pytest.mark.asyncio
async def test_explore_issue_area_prompt_contains_tool_references(db_url: str) -> None:
    """The explore_issue_area prompt should reference entity and relationship tools."""

    server = build_mcp_server(database_url=db_url)

    result = await server.get_prompt(
        "explore_issue_area",
        {"issue_area": "worker_cooperatives"},
    )
    text = result.messages[0].content.text

    assert len(text) > 0
    assert "worker_cooperatives" in text
    assert "search_entities" in text
    assert "get_entity" in text
    assert "get_related_entities" in text
    assert "atlas://issues/worker_cooperatives" in text


# ---------------------------------------------------------------------------
# Completion handler
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_completion_issue_key_returns_matching_slugs(db_url: str) -> None:
    """Autocomplete for issue_key should return slugs matching the partial input."""
    server = build_mcp_server(database_url=db_url)

    handler = server._mcp_server.request_handlers[mcp_types.CompleteRequest]  # noqa: SLF001
    request = mcp_types.CompleteRequest(
        params=mcp_types.CompleteRequestParams(
            ref=mcp_types.ResourceTemplateReference(
                type="ref/resource",
                uri="atlas://issues/{issue_key}",
            ),
            argument=mcp_types.CompletionArgument(name="issue_key", value="housing"),
        ),
    )
    result = await handler(request)
    values = result.root.completion.values

    assert len(values) > 0
    assert all(v.startswith("housing") for v in values)
    assert "housing_affordability" in values


@pytest.mark.asyncio
async def test_completion_issue_area_argument_also_works(db_url: str) -> None:
    """Autocomplete should also work for the issue_area argument name."""
    server = build_mcp_server(database_url=db_url)

    handler = server._mcp_server.request_handlers[mcp_types.CompleteRequest]  # noqa: SLF001
    request = mcp_types.CompleteRequest(
        params=mcp_types.CompleteRequestParams(
            ref=mcp_types.PromptReference(type="ref/prompt", name="investigate_place"),
            argument=mcp_types.CompletionArgument(name="issue_area", value="transport"),
        ),
    )
    result = await handler(request)
    values = result.root.completion.values

    assert len(values) > 0
    assert "transportation_and_mobility" in values


@pytest.mark.asyncio
async def test_completion_city_key_returns_examples(db_url: str) -> None:
    """Autocomplete for an empty city_key should return format examples."""
    server = build_mcp_server(database_url=db_url)

    handler = server._mcp_server.request_handlers[mcp_types.CompleteRequest]  # noqa: SLF001
    request = mcp_types.CompleteRequest(
        params=mcp_types.CompleteRequestParams(
            ref=mcp_types.ResourceTemplateReference(
                type="ref/resource",
                uri="atlas://cities/{city_key}",
            ),
            argument=mcp_types.CompletionArgument(name="city_key", value=""),
        ),
    )
    result = await handler(request)
    values = result.root.completion.values

    assert len(values) > 0
    assert "kansas-city-mo" in values


@pytest.mark.asyncio
async def test_completion_unknown_argument_returns_none(db_url: str) -> None:
    """Autocomplete for an unrecognized argument should return None/empty."""
    server = build_mcp_server(database_url=db_url)

    handler = server._mcp_server.request_handlers[mcp_types.CompleteRequest]  # noqa: SLF001
    request = mcp_types.CompleteRequest(
        params=mcp_types.CompleteRequestParams(
            ref=mcp_types.PromptReference(type="ref/prompt", name="investigate_place"),
            argument=mcp_types.CompletionArgument(name="unknown_arg", value="foo"),
        ),
    )
    result = await handler(request)

    assert result.root.completion.values == []


# ---------------------------------------------------------------------------
# Flag creation via data service (bypassing elicitation)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_entity_flag_persists_flag(
    test_db: object,  # noqa: ARG001
    db_url: str,
    sample_entry: str,
) -> None:
    """create_entity_flag should persist a flag and return the expected dict shape."""

    service = AtlasDataService(db_url)
    flag = await service.create_entity_flag(
        entity_id=sample_entry,
        reason="stale",
        note="Data appears outdated.",
    )

    assert "id" in flag
    assert flag["entity_id"] == sample_entry
    assert flag["reason"] == "stale"
    assert flag["status"] == "open"


@pytest.mark.asyncio
async def test_create_source_flag_persists_flag(
    test_db: object,  # noqa: ARG001
    db_url: str,
    sample_source: str,
) -> None:
    """create_source_flag should persist a flag and return the expected dict shape."""

    service = AtlasDataService(db_url)
    flag = await service.create_source_flag(
        source_id=sample_source,
        reason="broken_link",
        note="URL returns 404.",
    )

    assert "id" in flag
    assert flag["source_id"] == sample_source
    assert flag["reason"] == "broken_link"
    assert flag["status"] == "open"


@pytest.mark.asyncio
async def test_create_entity_flag_appears_in_flag_summary(
    test_db: object,
    db_url: str,
    sample_entry: str,
) -> None:
    """After flagging an entity, the flag should appear in entity flag summaries."""
    service = AtlasDataService(db_url)
    await service.create_entity_flag(
        entity_id=sample_entry,
        reason="duplicate",
    )

    flag_count = await FlagCRUD.count_entity_flags(test_db, entity_id=sample_entry)
    assert flag_count == 1


@pytest.mark.asyncio
async def test_create_source_flag_appears_in_flag_summary(
    test_db: object,
    db_url: str,
    sample_source: str,
) -> None:
    """After flagging a source, the flag should appear in source flag summaries."""
    service = AtlasDataService(db_url)
    await service.create_source_flag(
        source_id=sample_source,
        reason="irrelevant",
    )

    flag_count = await FlagCRUD.count_source_flags(test_db, source_id=sample_source)
    assert flag_count == 1


@pytest.mark.asyncio
async def test_create_entity_flag_without_note(
    test_db: object,  # noqa: ARG001
    db_url: str,
    sample_entry: str,
) -> None:
    """create_entity_flag should work without an optional note."""

    service = AtlasDataService(db_url)
    flag = await service.create_entity_flag(
        entity_id=sample_entry,
        reason="incorrect",
    )

    assert flag["reason"] == "incorrect"
    assert flag["status"] == "open"


@pytest.mark.asyncio
async def test_server_lists_prompts(db_url: str) -> None:
    """The MCP server should register all expected prompts."""

    server = build_mcp_server(database_url=db_url)
    prompts = await server.list_prompts()
    prompt_names = sorted(p.name for p in prompts)

    assert prompt_names == [
        "assess_coverage_gaps",
        "compare_places",
        "explore_issue_area",
        "investigate_place",
    ]
