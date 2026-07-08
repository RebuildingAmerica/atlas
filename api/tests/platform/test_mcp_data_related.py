"""Related-entity and moderation coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.platform.mcp.data import AtlasDataService


@pytest.mark.asyncio
async def test_get_related_entities_includes_all_relationship_types(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """All five relationship branches must surface for the seeded fixture."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    payload = await populated_service.get_related_entities(primary_id)
    assert payload["entity_id"] == primary_id
    assert payload["items"], "primary should have at least one related entity"
    relationships = payload["items"][0]["relationships"]
    types = {relationship["type"] for relationship in relationships}
    assert {"affiliated_member", "shared_issue_area", "shared_place", "shared_source"} <= types
    assert payload["items"][0]["entity"]["profile_url"] is None


@pytest.mark.asyncio
async def test_get_related_entities_profile_url_when_public_url_configured(
    db_url: str,
    test_db: object,
    populated_service: AtlasDataService,  # noqa: ARG001
) -> None:
    """get_related_entities threads public_url through to nested entity records."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    service = AtlasDataService(db_url, public_url="https://atlas.rebuildingus.org")
    payload = await service.get_related_entities(primary_id)
    assert payload["items"][0]["entity"]["profile_url"].startswith(
        "https://atlas.rebuildingus.org/profiles/organizations/"
    )


@pytest.mark.asyncio
async def test_get_related_entities_reverse_affiliated_organization(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """The reverse direction (looking up the affiliated child) emits affiliated_organization."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Related Org'")
    related_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_related_entities(related_id)
    types: set[str] = set()
    for item in payload["items"]:
        for relationship in item["relationships"]:
            types.add(relationship["type"])
    assert "affiliated_organization" in types


@pytest.mark.asyncio
async def test_get_related_entities_relation_filter_drops_non_matches(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """The relation_types filter only keeps requested kinds."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_related_entities(
        primary_id, relation_types=["affiliated_member"]
    )
    for item in payload["items"]:
        for relationship in item["relationships"]:
            assert relationship["type"] == "affiliated_member"


@pytest.mark.asyncio
async def test_get_related_entities_filter_can_yield_empty(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Filtering to a relation type the entity lacks yields no items."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_related_entities(
        primary_id, relation_types=["affiliated_organization"]
    )
    assert payload["items"] == []


@pytest.mark.asyncio
async def test_get_related_entities_partial_relationship_branches(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Cover the False branches for shared_issue_area and shared_source."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    sibling_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Sibling Org",
        description="Same place, no shared issues or sources, but affiliated.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=primary_id,
    )

    payload = await populated_service.get_related_entities(primary_id)
    by_id = {item["entity"]["id"]: item for item in payload["items"]}
    assert sibling_id in by_id
    types = {rel["type"] for rel in by_id[sibling_id]["relationships"]}
    assert "affiliated_member" in types
    assert "shared_place" in types
    assert "shared_issue_area" not in types
    assert "shared_source" not in types


@pytest.mark.asyncio
async def test_get_related_entities_respects_limit_and_cursor(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """A second affiliated sibling gives primary_id two related items to page over."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Second Sibling Org",
        description="Another affiliated sibling so there are two related items.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=primary_id,
    )

    first_page = await populated_service.get_related_entities(primary_id, limit=1)
    assert len(first_page["items"]) == 1
    assert first_page["total"] == 2
    assert first_page["next_cursor"] == "1"

    second_page = await populated_service.get_related_entities(
        primary_id, limit=1, cursor=first_page["next_cursor"]
    )
    assert len(second_page["items"]) == 1
    assert second_page["next_cursor"] is None
    assert first_page["items"][0]["entity"]["id"] != second_page["items"][0]["entity"]["id"]


@pytest.mark.asyncio
async def test_get_related_entities_invalid_cursor_raises(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    with pytest.raises(ValueError, match="Invalid cursor"):
        await populated_service.get_related_entities(primary_id, cursor="not-a-number")


@pytest.mark.asyncio
async def test_get_related_entities_falsy_same_place_branch(db_url: str, test_db: object) -> None:
    """When the entity has no city, `same_place` evaluates False even with state match."""
    conn = test_db
    placeless_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Placeless Primary",
        description="Has a state but no city.",
        city=None,
        state="IN",
        geo_specificity="statewide",
    )
    other_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Other In-State",
        description="Same state, different city.",
        city="Indianapolis",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=placeless_id,
    )

    service = AtlasDataService(db_url)
    payload = await service.get_related_entities(placeless_id)
    types: set[str] = set()
    for item in payload["items"]:
        if item["entity"]["id"] == other_id:
            types = {rel["type"] for rel in item["relationships"]}
    assert "shared_place" not in types
    assert "affiliated_member" in types


@pytest.mark.asyncio
async def test_get_related_entities_isolated_entry_yields_empty(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """An entry with no shared place, issues, or sources returns no relationships."""
    conn = test_db
    isolated_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Isolated Org",
        description="Has no neighbors.",
        city="Boise",
        state="ID",
        geo_specificity="local",
    )
    payload = await populated_service.get_related_entities(isolated_id)
    assert payload["items"] == []


@pytest.mark.asyncio
async def test_get_related_entities_not_found_raises(
    populated_service: AtlasDataService,
) -> None:
    with pytest.raises(ValueError, match="Entity not found"):
        await populated_service.get_related_entities("missing")


@pytest.mark.asyncio
async def test_create_entity_flag_persists_record(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    flag = await populated_service.create_entity_flag(primary_id, reason="duplicate", note="dup")
    assert flag["entity_id"] == primary_id
    assert flag["reason"] == "duplicate"
    assert flag["status"] == "open"


@pytest.mark.asyncio
async def test_create_source_flag_persists_record(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM sources LIMIT 1")
    source_id = (await cursor.fetchone())[0]
    flag = await populated_service.create_source_flag(source_id, reason="incorrect", note=None)
    assert flag["source_id"] == source_id
    assert flag["status"] == "open"
