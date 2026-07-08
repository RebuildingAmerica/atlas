"""Entity and source query coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

from dataclasses import replace

from datetime import date, timedelta

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.source import SourceCRUD
from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import AtlasDataService

from tests.platform.mcp_data_support import _build_entry


@pytest.mark.asyncio
async def test_search_entities_returns_items_with_pagination(
    populated_service: AtlasDataService,
) -> None:
    """search_entities with `limit=1` should expose a next_cursor."""
    page = await populated_service.search_entities(place="Gary, IN", limit=1)
    assert page["total"] >= 2  # noqa: PLR2004
    assert len(page["items"]) == 1
    assert page["next_cursor"] == "1"
    assert page["place"]["display"] == "Gary, IN"


@pytest.mark.asyncio
async def test_search_entities_without_place_returns_empty_page(db_url: str) -> None:
    """Searches without a place scope should fail closed with no matches."""
    service = AtlasDataService(db_url)

    page = await service.search_entities(place_filters=[], limit=1)

    assert page["items"] == []
    assert page["total"] == 0
    assert page["next_cursor"] is None


@pytest.mark.asyncio
async def test_search_entities_no_results_no_cursor(
    populated_service: AtlasDataService,
) -> None:
    """A query that matches nothing yields an empty page with no cursor."""
    page = await populated_service.search_entities(text="zzqqxxxnonsense")
    assert page["items"] == []
    assert page["next_cursor"] is None


@pytest.mark.asyncio
async def test_get_place_entities_alias_delegates_to_search(
    populated_service: AtlasDataService,
) -> None:
    """`get_place_entities` is a place-first alias for `search_entities`."""
    page = await populated_service.get_place_entities("Gary, IN")
    assert page["total"] >= 1


@pytest.mark.asyncio
async def test_get_place_entities_sorts_by_objective_actor_fields(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Place actor sorting should use stable fields already computed by Atlas."""
    conn = test_db
    alphabetical_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Aardvark Civic League",
        description="Alphabetical coverage fixture.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    recent_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Zeta Recent Coalition",
        description="Recent coverage fixture.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    recent_source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/recent-zeta",
        source_type="report",
        extraction_method="manual",
        title="Recent Zeta report",
        publication="Example Journal",
        published_date=date.today() + timedelta(days=1),  # noqa: DTZ011
    )
    await SourceCRUD.link_to_entry(conn, recent_id, recent_source_id)
    await conn.commit()

    by_source_count = await populated_service.get_place_entities("Gary, IN", sort="source_count")
    by_recent = await populated_service.get_place_entities("Gary, IN", sort="recent")
    by_name = await populated_service.get_place_entities("Gary, IN", sort="name")

    assert by_source_count["items"][0]["name"] == "Atlas Primary Org"
    assert by_recent["items"][0]["name"] == "Zeta Recent Coalition"
    assert by_name["items"][0]["id"] == alphabetical_id


@pytest.mark.asyncio
async def test_get_place_entities_rejects_unknown_sort(
    populated_service: AtlasDataService,
) -> None:
    """Unknown place actor sort values should fail instead of falling back."""
    with pytest.raises(ValueError, match="Invalid entity sort"):
        await populated_service.get_place_entities("Gary, IN", sort="made_up")


@pytest.mark.asyncio
async def test_search_entities_profile_url_none_by_default(
    populated_service: AtlasDataService,
) -> None:
    """Without a configured public_url, search_entities leaves profile_url as None."""
    page = await populated_service.search_entities(place="Gary, IN", limit=1)
    assert page["items"][0]["profile_url"] is None


@pytest.mark.asyncio
async def test_search_entities_profile_url_when_public_url_configured(
    db_url: str,
    populated_service: AtlasDataService,  # noqa: ARG001
) -> None:
    """search_entities builds an absolute profile_url once the service has a public_url."""
    service = AtlasDataService(db_url, public_url="https://atlas.rebuildingus.org")
    page = await service.search_entities(place="Gary, IN", limit=1)
    assert page["items"][0]["profile_url"].startswith(
        "https://atlas.rebuildingus.org/profiles/organizations/"
    )


@pytest.mark.asyncio
async def test_get_entity_returns_detail_payload(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """`get_entity` should expand sources and relationship_ids."""
    conn = test_db
    primary = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await primary.fetchone())[0]

    detail = await populated_service.get_entity(primary_id)
    assert detail["id"] == primary_id
    assert detail["sources"], "primary entity should have linked sources"
    assert any(rid.startswith("atlas://") for rid in detail["relationship_ids"])


@pytest.mark.asyncio
async def test_get_entity_excludes_suppressed_sources(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Suppressed source ids should be filtered out by default."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    cursor = await conn.execute(
        "SELECT source_id FROM entry_sources WHERE entry_id = ?", (primary_id,)
    )
    rows = await cursor.fetchall()
    assert rows
    suppressed = rows[0][0]
    await EntryCRUD.update(conn, primary_id, suppressed_source_ids=[suppressed])

    public_view = await populated_service.get_entity(primary_id)
    assert all(source["id"] != suppressed for source in public_view["sources"])
    assert suppressed not in public_view["source_ids"]

    admin_view = await populated_service.get_entity(primary_id, include_suppressed=True)
    assert any(source["id"] == suppressed for source in admin_view["sources"])


@pytest.mark.asyncio
async def test_get_entity_not_found_raises(populated_service: AtlasDataService) -> None:
    with pytest.raises(ValueError, match="Entity not found"):
        await populated_service.get_entity("does-not-exist")


@pytest.mark.asyncio
async def test_get_entity_profile_url_none_without_configured_public_url(
    populated_service: AtlasDataService, test_db: object
) -> None:
    """Without a configured public_url, get_entity leaves profile_url as None."""
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    detail = await populated_service.get_entity(primary_id)
    assert detail["profile_url"] is None


@pytest.mark.asyncio
async def test_get_entity_profile_url_when_public_url_configured(
    db_url: str,
    test_db: object,
    populated_service: AtlasDataService,  # noqa: ARG001
) -> None:
    """get_entity builds an absolute profile_url once the service has a public_url."""
    conn = test_db
    cursor = await conn.execute("SELECT id, slug FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id, primary_slug = await cursor.fetchone()

    service = AtlasDataService(db_url, public_url="https://atlas.rebuildingus.org")
    detail = await service.get_entity(primary_id)
    assert (
        detail["profile_url"]
        == f"https://atlas.rebuildingus.org/profiles/organizations/{primary_slug}"
    )


@pytest.mark.asyncio
async def test_get_entity_sources_returns_payload(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    payload = await populated_service.get_entity_sources(primary_id)
    assert payload["entity_id"] == primary_id
    assert payload["sources"]


@pytest.mark.asyncio
async def test_get_entity_sources_filters_suppressed(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]
    cursor = await conn.execute(
        "SELECT source_id FROM entry_sources WHERE entry_id = ?", (primary_id,)
    )
    suppressed = (await cursor.fetchone())[0]
    await EntryCRUD.update(conn, primary_id, suppressed_source_ids=[suppressed])

    public_view = await populated_service.get_entity_sources(primary_id)
    assert all(source["id"] != suppressed for source in public_view["sources"])

    admin_view = await populated_service.get_entity_sources(primary_id, include_suppressed=True)
    assert any(source["id"] == suppressed for source in admin_view["sources"])


@pytest.mark.asyncio
async def test_get_entity_sources_not_found_raises(
    populated_service: AtlasDataService,
) -> None:
    with pytest.raises(ValueError, match="Entity not found"):
        await populated_service.get_entity_sources("missing")


@pytest.mark.asyncio
async def test_get_entity_sources_respects_limit(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    payload = await populated_service.get_entity_sources(primary_id, limit=1)

    assert len(payload["sources"]) == 1
    assert payload["total"] == 2
    assert payload["next_cursor"] == "1"


@pytest.mark.asyncio
async def test_get_entity_sources_second_page_via_cursor(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    first_page = await populated_service.get_entity_sources(primary_id, limit=1)
    second_page = await populated_service.get_entity_sources(
        primary_id, limit=1, cursor=first_page["next_cursor"]
    )

    assert len(second_page["sources"]) == 1
    assert second_page["next_cursor"] is None
    assert first_page["sources"][0]["id"] != second_page["sources"][0]["id"]


@pytest.mark.asyncio
async def test_get_entity_sources_invalid_cursor_raises(
    populated_service: AtlasDataService, test_db: object
) -> None:
    conn = test_db
    cursor = await conn.execute("SELECT id FROM entries WHERE name = 'Atlas Primary Org'")
    primary_id = (await cursor.fetchone())[0]

    with pytest.raises(ValueError, match="Invalid cursor"):
        await populated_service.get_entity_sources(primary_id, cursor="not-a-number")


@pytest.mark.asyncio
async def test_search_sources_applies_filters_and_text(
    populated_service: AtlasDataService,
) -> None:
    """Hit each filter clause: place, issue_areas, source_types, text."""
    payload = await populated_service.search_sources(
        place="Gary, IN",
        issue_areas=["housing_affordability"],
        source_types=["news_article", "report"],
        text="article",
        limit=1,
    )
    assert payload["items"]
    assert payload["next_cursor"] in {None, "1"}


@pytest.mark.asyncio
async def test_search_sources_region_filter_returns_empty_for_unknown(
    populated_service: AtlasDataService,
) -> None:
    """Region filter without matches still returns a structured empty page."""
    payload = await populated_service.search_sources(place={"region": "Nowhere"}, limit=10)
    assert payload["items"] == []
    assert payload["next_cursor"] is None


@pytest.mark.asyncio
async def test_search_sources_no_filters(populated_service: AtlasDataService) -> None:
    """No-filter call returns all sources (covers the `1 = 1` baseline)."""
    payload = await populated_service.search_sources()
    assert payload["total"] >= 1


@pytest.mark.asyncio
async def test_get_place_sources_alias(populated_service: AtlasDataService) -> None:
    payload = await populated_service.get_place_sources("Gary, IN")
    assert payload["total"] >= 1


@pytest.mark.asyncio
async def test_search_sources_under_limit_no_cursor(
    populated_service: AtlasDataService,
) -> None:
    """When fewer rows come back than `limit`, next_cursor stays None."""
    payload = await populated_service.search_sources(limit=100)
    assert payload["next_cursor"] is None


def test_contact_source_ids_returns_matching_source_id() -> None:
    """Matching source receipts should be surfaced for contact claims."""
    entry = replace(_build_entry(), website="https://primary.example", email="info@primary.example")
    source_ids = data_module._contact_source_ids(  # noqa: SLF001
        entry,
        [
            {
                "id": "source-1",
                "url": "https://primary.example/story",
                "extraction_context": "primary.example mentions contact details",
            },
            {
                "id": None,
                "url": "https://primary.example/about",
                "extraction_context": "info@primary.example listed here",
            },
        ],
    )
    assert source_ids == ["source-1"]
