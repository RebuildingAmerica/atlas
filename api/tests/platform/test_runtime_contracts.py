"""Cross-domain runtime contract tests for the Atlas service."""

from __future__ import annotations

import json
import tempfile
import types
from datetime import UTC, date, datetime, timedelta
from http import HTTPStatus

import pytest

from atlas import main as main_module
from atlas.domains.catalog.models.entry import (
    _empty_facets,
    _facet_rows_to_dicts,
    _make_placeholders,
)
from atlas.domains.catalog.taxonomy import get_issue_area_by_slug, get_issues_by_domain
from atlas.domains.discovery.pipeline.deduplicator import (
    _match_type,
    _merge_entries,
    _similarity_ratio,
)
from atlas.domains.discovery.pipeline.extractor import (
    _parse_extraction_response,
    _strip_code_fence,
    extract_entries,
)
from atlas.domains.discovery.pipeline.query_generator import generate_queries
from atlas.domains.discovery.pipeline.ranker import (
    DEFAULT_STALENESS_DAYS,
    _days_since,
    _today_date,
    rank_entries,
)
from atlas.domains.discovery.pipeline.runner import (
    _parse_date,
    _persist_issue_areas,
    _persist_sources,
    _upsert_entry,
)
from atlas.domains.discovery.pipeline.source_fetcher import (
    _infer_source_type,
    _parse_result_age,
    fetch_sources,
)
from atlas.main import configure_logging, create_app, lifespan
from atlas.models import DiscoveryRunCRUD, EntryCRUD, SourceCRUD, get_db_connection
from atlas.platform import database as database_module
from atlas.platform.config import Settings
from atlas.platform.database import _ensure_entry_columns, _get_db_path, db
from atlas.platform.mcp.data import (
    AtlasDataService,
    DatabaseSession,
    _clean_string,
    _coerce_date,
    _decode_cursor,
    _format_place,
    _latest_source_date,
    _normalize_place,
    _normalize_state,
    _place_resource_slug,
    _relationship_ids,
    _staleness,
    _tokenize,
    _validate_issue_areas,
)
from atlas.platform.mcp.server import build_mcp_server

EXPECTED_SEARCH_TOTAL = 1
EXPECTED_STATUS_OK = HTTPStatus.OK
MIN_EXPECTED_PAGED_TOTAL = 2
SCHEMA_FAILURE_ERROR = "schema failure"


@pytest.mark.asyncio
async def test_database_runtime_support_handles_url_json_and_additive_migration() -> None:
    """Database runtime support should handle URL parsing, JSON, and additive migration."""
    assert _get_db_path("sqlite:///atlas.db") == "atlas.db"
    assert _get_db_path("sqlite://relative.db") == "relative.db"
    assert _get_db_path("plain.db") == "plain.db"
    assert db.decode_json(db.encode_json({"a": [1]})) == {"a": [1]}
    assert isinstance(db.generate_uuid(), str)
    assert datetime.fromisoformat(db.now_iso()).tzinfo == UTC

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as handle:
        db_url = f"sqlite:///{handle.name}"

    conn = await get_db_connection(db_url)
    await conn.execute("CREATE TABLE entries (id TEXT PRIMARY KEY, name TEXT)")
    await conn.commit()
    await _ensure_entry_columns(conn)
    cursor = await conn.execute("PRAGMA table_info(entries)")
    columns = {row[1] for row in await cursor.fetchall()}
    await conn.close()

    assert "full_address" in columns


@pytest.mark.asyncio
async def test_app_lifespan_initializes_database_and_surfaces_startup_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The app lifespan should initialize the database and surface startup failures."""
    configure_logging(Settings(log_level="debug"))
    app = create_app()
    assert app.title == "Atlas REST API"

    called: dict[str, object] = {}

    async def fake_init_db(database_url: str) -> None:
        called["ok"] = database_url

    monkeypatch.setattr("atlas.main.get_settings", lambda: Settings(database_url="sqlite:///ok.db"))
    monkeypatch.setattr("atlas.main.init_db", fake_init_db)

    async with lifespan(app):
        pass
    assert called["ok"] == "sqlite:///ok.db"

    async def failing_init_db(database_url: str) -> None:
        raise RuntimeError(database_url)

    monkeypatch.setattr("atlas.main.init_db", failing_init_db)
    with pytest.raises(RuntimeError, match=r"sqlite:///ok\.db"):
        async with lifespan(app):
            pass


@pytest.mark.asyncio
async def test_oauth_protected_resource_metadata_endpoint_reflects_runtime_settings(
    test_client: object,
) -> None:
    """The OAuth resource metadata endpoint should publish the service contract shape."""
    response = await test_client.get("/.well-known/oauth-protected-resource")

    assert response.status_code == EXPECTED_STATUS_OK
    assert response.headers["cache-control"].startswith("public, max-age=15")
    payload = response.json()
    assert payload["resource"] == ""
    assert payload["authorization_servers"] == [""]
    assert payload["bearer_methods_supported"] == ["header"]
    assert payload["scopes_supported"] == [
        "openid",
        "profile",
        "email",
        "discovery:read",
        "discovery:write",
        "entities:write",
    ]


def test_settings_and_taxonomy_support_runtime_resolution() -> None:
    """Runtime settings and taxonomy lookups should resolve predictable values."""
    settings = Settings(database_url="sqlite:///example.db")
    assert settings.get_database_url() == "sqlite:///example.db"
    derived_jwks = Settings(ATLAS_PUBLIC_URL="https://atlas.example.com")
    assert derived_jwks.auth_jwt_jwks_url == "https://atlas.example.com/api/auth/jwks"
    assert get_issue_area_by_slug("housing_affordability") is not None
    assert get_issue_area_by_slug("not-a-real-issue") is None
    assert get_issues_by_domain("Housing and the Built Environment")
    assert get_issues_by_domain("Unknown Domain") == []


@pytest.mark.asyncio
async def test_discovery_run_crud_end_to_end(test_db: object) -> None:
    """Discovery runs should cover create, list, update, complete, and fail paths."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
    )
    run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
    assert run is not None
    assert run.to_dict()["id"] == run_id

    runs = await DiscoveryRunCRUD.list(test_db, state="MO", status="running")
    assert runs
    assert runs[0].id == run_id
    assert await DiscoveryRunCRUD.update(test_db, run_id, invalid_field="ignored") is False
    assert await DiscoveryRunCRUD.complete(
        test_db,
        run_id,
        queries_generated=4,
        entries_confirmed=2,
    )
    completed = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
    assert completed is not None
    assert completed.status == "completed"
    assert await DiscoveryRunCRUD.fail(test_db, run_id, "boom")
    failed = await DiscoveryRunCRUD.get_by_id(test_db, run_id)
    assert failed is not None
    assert failed.error_message == "boom"
    assert await DiscoveryRunCRUD.get_by_id(test_db, "missing") is None
    assert await DiscoveryRunCRUD.list(test_db, state="KS") == []


@pytest.mark.asyncio
async def test_source_crud_preserves_links_metadata_and_delete_paths(test_db: object) -> None:
    """Source CRUD should preserve metadata and linked-entity behavior across mutations."""
    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Source Org",
        description="Organization for source linking tests.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    assert await SourceCRUD.get_by_id(test_db, "missing") is None
    assert await SourceCRUD.get_by_url(test_db, "missing") is None
    assert await SourceCRUD.list(test_db) == []

    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/source",
        source_type="report",
        extraction_method="manual",
        title="Source Title",
        publication="Source Publication",
        published_date=date(2026, 3, 1),
        raw_content="content",
    )
    source = await SourceCRUD.get_by_id(test_db, source_id)
    assert source is not None
    assert source.to_dict()["published_date"] == "2026-03-01"
    assert (await SourceCRUD.get_by_url(test_db, "https://example.com/source")) is not None
    assert (
        len(await SourceCRUD.list(test_db, source_type="report", extraction_method="manual")) == 1
    )
    assert await SourceCRUD.update(test_db, source_id, unsupported="x") is False
    assert await SourceCRUD.update(test_db, source_id, title="Updated")
    await SourceCRUD.link_to_entry(test_db, actor_id, source_id, "ctx")
    assert await SourceCRUD.unlink_from_entry(test_db, actor_id, source_id)
    assert await SourceCRUD.unlink_from_entry(test_db, actor_id, source_id) is False
    assert await SourceCRUD.delete(test_db, source_id)
    assert await SourceCRUD.delete(test_db, source_id) is False


@pytest.mark.asyncio
async def test_entry_crud_and_public_search_cover_filters_facets_and_empty_states(
    test_db: object,
) -> None:
    """Entry CRUD should cover filters, public search, facets, and empty states."""
    assert await EntryCRUD.list(test_db, state="MO") == []
    assert await EntryCRUD.search_fts(test_db, "nothing") == []
    assert await EntryCRUD.filter_by_issue_area(test_db, "housing_affordability") == []
    assert await EntryCRUD.get_with_sources(test_db, "missing") == (None, [])
    assert await EntryCRUD.get_issue_areas_for_entries(test_db, []) == {}
    assert await EntryCRUD.get_sources_for_entries(test_db, []) == {}
    assert await EntryCRUD.search_public(test_db, query="missing") == {
        "entries": [],
        "total": 0,
        "facets": _empty_facets(),
    }

    org_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Housing Justice KC",
        description="Tenant organizers building stronger renter protections.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        website="https://housing.example",
    )
    await test_db.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
        (org_id, "housing_affordability"),
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/housing",
        source_type="news_article",
        extraction_method="manual",
        title="Housing Story",
        publication="Metro News",
        published_date=date(2026, 1, 1),
    )
    await SourceCRUD.link_to_entry(test_db, org_id, source_id, "context")

    assert (
        len(
            await EntryCRUD.list(test_db, state="MO", city="Kansas City", entry_type="organization")
        )
        == 1
    )
    assert len(await EntryCRUD.search_fts(test_db, "Housing")) == 1
    assert (
        len(await EntryCRUD.filter_by_issue_area(test_db, "housing_affordability", state="MO")) == 1
    )
    assert await EntryCRUD.update(test_db, org_id, unsupported="value") is False
    assert await EntryCRUD.update(
        test_db,
        org_id,
        social_media={"instagram": "housingkc"},
        phone="555-1111",
        verified=True,
    )
    entry = await EntryCRUD.get_by_id(test_db, org_id)
    assert entry is not None
    assert entry.to_dict()["social_media"] == {"instagram": "housingkc"}

    with_sources = await EntryCRUD.get_with_sources(test_db, org_id)
    assert with_sources[0] is not None
    assert len(with_sources[1]) == EXPECTED_SEARCH_TOTAL
    assert await EntryCRUD.get_issue_areas(test_db, org_id) == ["housing_affordability"]
    assert await EntryCRUD.get_issue_areas_for_entries(test_db, [org_id]) == {
        org_id: ["housing_affordability"]
    }
    source_map = await EntryCRUD.get_sources_for_entries(test_db, [org_id])
    assert source_map[org_id][0]["id"] == source_id

    search = await EntryCRUD.search_public(
        test_db,
        query="Housing",
        states=["MO"],
        cities=["Kansas City"],
        issue_areas=["housing_affordability"],
        entry_types=["organization"],
        source_types=["news_article"],
    )
    assert search["total"] == 1
    assert search["facets"]["states"][0]["value"] == "MO"
    assert _make_placeholders([1, 2, 3]) == "?, ?, ?"
    assert _facet_rows_to_dicts([("MO", 2)]) == [{"value": "MO", "count": 2}]
    assert await EntryCRUD.delete(test_db, "missing") is False


@pytest.mark.asyncio
async def test_pipeline_support_functions_cover_fallback_runtime_paths(test_db: object) -> None:
    """Pipeline support functions should cover fallback runtime paths."""
    assert _similarity_ratio("Maria", "maria") == 1.0
    assert (
        _match_type(
            {"name": "Org", "entry_type": "organization", "city": "KC"},
            {"name": "Org", "entry_type": "organization", "city": "Elsewhere"},
        )
        == "merge"
    )
    assert (
        _match_type(
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "city": "KC",
                "affiliated_org": "Org",
            },
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "city": "KC",
                "affiliated_org": "Org",
            },
        )
        == "merge"
    )
    assert (
        _match_type(
            {
                "name": "Maria Gonzalez",
                "entry_type": "person",
                "city": "KC",
                "affiliated_org": "Org",
            },
            {
                "name": "Maria Gonzales",
                "entry_type": "person",
                "city": "KC",
                "affiliated_org": "Org",
            },
        )
        == "flag"
    )
    assert (
        _match_type(
            {"name": "Same Name", "entry_type": "organization", "city": "KC"},
            {"name": "Same Name", "entry_type": "organization", "city": "STL"},
        )
        == "flag"
    )
    assert (
        _match_type(
            {"name": "One", "entry_type": "organization", "city": "KC"},
            {"name": "Two", "entry_type": "organization", "city": "STL"},
        )
        is None
    )

    merged = _merge_entries(
        {
            "description": "short",
            "issue_areas": ["a"],
            "source_urls": ["u1"],
            "source_dates": ["2026-01-01"],
            "social_media": {"instagram": "a"},
        },
        {
            "description": "longer description",
            "issue_areas": ["b"],
            "source_urls": ["u2"],
            "source_dates": ["2026-01-02"],
            "social_media": {"twitter": "b"},
            "email": "x@example.com",
        },
    )
    assert merged["last_seen"] == "2026-01-02"
    assert merged["email"] == "x@example.com"
    assert merged["social_media"] == {"instagram": "a", "twitter": "b"}

    assert generate_queries("KC", "MO", ["not_real"]) == []
    assert _days_since(None) == DEFAULT_STALENESS_DAYS
    assert _days_since(_today_date()) == 0
    assert (
        rank_entries([{"name": "A", "description": "desc"}])[0].components["source_density"] == 0.0
    )
    assert _parse_result_age(None) is None
    assert _infer_source_type("https://example.com/report.pdf", None) == "report"
    assert _infer_source_type("https://example.gov/doc", None) == "government_record"

    assert await fetch_sources([], _api_key="x") == []
    assert await fetch_sources(["query"], _api_key=None) == []
    assert _strip_code_fence("```json\n[]\n```") == "[]"
    parsed = _parse_extraction_response(
        json.dumps(
            {
                "entries": [
                    {
                        "name": "Entry",
                        "type": "organization",
                        "description": "Desc",
                        "geo_specificity": "local",
                        "contact_surface": {
                            "website": "https://x.example",
                            "email": "x@example.com",
                        },
                    }
                ]
            }
        )
    )
    assert parsed[0].website == "https://x.example"
    assert await extract_entries("https://x", "   ", "KC", "MO", _api_key="key") == []

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Runner Org",
        description="Pipeline helper coverage org.",
        city="KC",
        state="MO",
        geo_specificity="local",
    )
    inserted_id = await _upsert_entry(
        test_db,
        {
            "entry_type": "organization",
            "name": "Runner Org 2",
            "description": "Inserted from pipeline runner.",
            "city": "KC",
            "state": "MO",
            "geo_specificity": "local",
            "source_dates": ["2026-01-01"],
            "last_seen": "2026-01-02",
        },
    )
    assert inserted_id
    updated_id = await _upsert_entry(
        test_db,
        {
            "entry_type": "organization",
            "name": "Runner Org",
            "description": "Updated description.",
            "city": "KC",
            "state": "MO",
            "geo_specificity": "local",
            "source_dates": ["2026-01-03"],
            "last_seen": "2026-01-03",
        },
    )
    assert updated_id == actor_id
    await _persist_issue_areas(
        test_db, actor_id, ["housing_affordability", "housing_affordability"]
    )

    class FakeSource:
        def __init__(self) -> None:
            self.url = "https://example.com/persisted"
            self.source_type = "report"
            self.title = "Persisted"
            self.publication = "Example"
            self.published_date = "2026-01-04"
            self.content = "body"

    await _persist_sources(
        test_db,
        entry_id=actor_id,
        source_urls=["https://example.com/persisted"],
        source_contexts={"https://example.com/persisted": "ctx"},
        source_by_url={"https://example.com/persisted": FakeSource()},
    )
    await _persist_sources(
        test_db,
        entry_id=actor_id,
        source_urls=["https://example.com/persisted"],
        source_contexts={"https://example.com/persisted": "ctx"},
        source_by_url={"https://example.com/persisted": FakeSource()},
    )
    assert _parse_date("2026-01-04") == date(2026, 1, 4)


@pytest.mark.asyncio
async def test_mcp_data_layer_normalizes_inputs_and_surfaces_errors(
    test_db: object,
    db_url: str,
) -> None:
    """The MCP data layer should normalize inputs and surface expected errors."""
    service = AtlasDataService(db_url)
    assert _normalize_place(None) == {"city": None, "state": None, "region": None, "display": None}
    assert _normalize_place({"city": " KC ", "state": "mo", "region": "metro", "display": ""}) == {
        "city": "KC",
        "state": "MO",
        "region": "metro",
        "display": "KC, MO",
    }
    assert _normalize_place("RegionOnly")["city"] == "RegionOnly"
    assert (
        _place_resource_slug({"city": "Kansas City", "state": "MO", "region": None})
        == "kansas-city-mo"
    )
    assert _normalize_state(" ") is None
    assert _clean_string("  hi ") == "hi"
    assert _format_place(None, None, "Metro") == "Metro"
    assert _decode_cursor(None) == 0
    assert _decode_cursor("-3") == 0
    assert _tokenize("A-B, C!") == ["a", "b", "c"]
    with pytest.raises(ValueError, match="Invalid issue area"):
        _validate_issue_areas(["fake"])
    assert (
        _latest_source_date([{"ingested_at": "2026-01-05T10:00:00Z"}], "2026-01-01") == "2026-01-05"
    )
    rels = _relationship_ids(
        "actor", types.SimpleNamespace(affiliated_org_id="org"), ["housing_affordability"]
    )
    assert rels[-1].endswith("/affiliated_organization/org")

    assert await service.search_entities(cursor="1", limit=1) == {
        "items": [],
        "total": 0,
        "next_cursor": None,
        "facets": None,
        "place": {
            "city": None,
            "state": None,
            "region": None,
            "full_address": None,
            "geo_specificity": None,
            "display": None,
        },
    }
    with pytest.raises(ValueError, match="Entity not found"):
        await service.get_entity_sources("missing")
    with pytest.raises(ValueError, match="Entity not found"):
        await service.get_related_entities("missing")

    actor_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Filtered Org",
        description="An org for relationship filtering and source search.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        affiliated_org_id=None,
    )
    member_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Member Person",
        description="Works with Filtered Org.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        affiliated_org_id=actor_id,
        phone="555-2222",
    )
    await test_db.executemany(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
        [
            (actor_id, "housing_affordability"),
            (member_id, "housing_affordability"),
        ],
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/no-text",
        source_type="report",
        extraction_method="manual",
        title="Coverage report",
    )
    await SourceCRUD.link_to_entry(test_db, actor_id, source_id, None)
    await SourceCRUD.link_to_entry(test_db, member_id, source_id, None)

    source_search = await service.search_sources(source_types=["report"], cursor="0")
    assert source_search["items"][0]["id"] == source_id
    assert actor_id in source_search["items"][0]["linked_entity_ids"]
    filtered = await service.get_related_entities(
        member_id, relation_types=["affiliated_organization"]
    )
    assert filtered["items"][0]["relationships"] == [
        {"type": "affiliated_organization", "issue_area_ids": [], "source_ids": []}
    ]

    server = build_mcp_server(database_url=db_url)
    assert (await server.call_tool("get_entity_sources", {"entity_id": actor_id}))[1][
        "entity_id"
    ] == actor_id
    assert (await server.call_tool("resolve_issue_areas", {"text": "housing", "limit": 1}))[1][
        "items"
    ]
    assert (await server.call_tool("get_place_coverage", {"place": "Kansas City, MO"}))[1]["place"][
        "city"
    ] == "Kansas City"
    assert (
        await server.call_tool(
            "get_related_entities",
            {"entity_id": member_id, "relation_types": ["affiliated_organization"]},
        )
    )[1]["items"]

    with pytest.raises(ValueError, match="Source not found"):
        await server.read_resource("atlas://sources/missing")
    with pytest.raises(ValueError, match="Issue resource not found"):
        await server.read_resource("atlas://issues/missing")
    with pytest.raises(ValueError, match="Unknown state code"):
        await server.read_resource("atlas://states/ZZ/coverage")
    with pytest.raises(ValueError, match="Unsupported place key"):
        await server.read_resource("atlas://cities/invalid/coverage")


@pytest.mark.asyncio
async def test_init_db_re_raises_failures_and_closes_connections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Database initialization should always close connections, even on failure."""

    events: list[str] = []

    class FailingConnection:
        async def executescript(self, _schema: str) -> None:
            raise RuntimeError(SCHEMA_FAILURE_ERROR)

        async def commit(self) -> None:
            events.append("commit")

        async def close(self) -> None:
            events.append("close")

    async def fake_get_db_connection(database_url: str) -> FailingConnection:
        assert database_url == "sqlite:///failure.db"
        return FailingConnection()

    monkeypatch.setattr(database_module, "get_db_connection", fake_get_db_connection)

    with pytest.raises(RuntimeError, match=SCHEMA_FAILURE_ERROR):
        await database_module.init_db("sqlite:///failure.db")

    assert events == ["close"]


@pytest.mark.asyncio
async def test_mcp_data_layer_additional_branches_cover_remaining_place_and_freshness_edges(
    test_db: object,
    db_url: str,
) -> None:
    """The MCP data layer should cover remaining normalization and relationship branches."""
    service = AtlasDataService(db_url)
    assert _normalize_place("mo") == {"city": None, "state": "MO", "region": None, "display": "MO"}
    assert _place_resource_slug({"city": None, "state": "MO", "region": None}) == "mo"
    assert _normalize_state(None) is None
    assert _format_place(None, "MO", None) == "MO"
    assert (
        _latest_source_date([{"published_date": None, "ingested_at": None}], "2026-01-01")
        == "2026-01-01"
    )
    assert _coerce_date(None) is None
    assert _coerce_date("not-a-date") is None
    assert _staleness(None, "entity data")[0] == "unknown"
    assert (
        _staleness(
            (datetime.now(UTC).date() - timedelta(days=200)).isoformat(),
            "entity data",
        )[0]
        == "aging"
    )

    session = DatabaseSession(db_url)
    await session.__aexit__(None, None, None)

    first_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Regional Housing Alliance",
        description="Regional housing organization for MCP branch coverage.",
        city="Kansas City",
        state="MO",
        region="Midwest",
        geo_specificity="regional",
    )
    second_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Regional Tenant Network",
        description="Second regional housing organization for pagination coverage.",
        city="Kansas City",
        state="MO",
        region="Midwest",
        geo_specificity="regional",
    )
    unrelated_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Unrelated Org",
        description="Unrelated entry that should not create a relationship.",
        city="St. Louis",
        state="MO",
        geo_specificity="local",
    )
    member_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Alex Organizer",
        description="Member affiliated with the regional housing alliance.",
        city="Kansas City",
        state="MO",
        region="Midwest",
        geo_specificity="regional",
        affiliated_org_id=first_id,
    )
    await test_db.executemany(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
        [
            (first_id, "housing_affordability"),
            (second_id, "housing_affordability"),
            (second_id, "community_health_infrastructure"),
            (member_id, "housing_affordability"),
            (unrelated_id, "community_health_infrastructure"),
        ],
    )
    first_source = await SourceCRUD.create(
        test_db,
        url="https://example.com/regional-one",
        source_type="report",
        extraction_method="manual",
        title="Regional report one",
    )
    second_source = await SourceCRUD.create(
        test_db,
        url="https://example.com/regional-two",
        source_type="report",
        extraction_method="manual",
        title="Regional report two",
    )
    await SourceCRUD.link_to_entry(test_db, first_id, first_source, "regional context")
    await SourceCRUD.link_to_entry(test_db, second_id, second_source, "regional context")
    await test_db.commit()

    paged_search = await service.search_entities(place="Kansas City, MO", limit=1)
    assert paged_search["total"] >= MIN_EXPECTED_PAGED_TOTAL
    assert paged_search["next_cursor"] == "1"

    regional_search = await service.search_sources(place={"region": "Midwest"}, cursor="0")
    assert regional_search["total"] >= MIN_EXPECTED_PAGED_TOTAL

    filtered_signals = await service.get_place_issue_signals(
        "Kansas City, MO",
        issue_areas=["housing_affordability"],
    )
    assert all(
        item["issue_area_id"] == "housing_affordability" for item in filtered_signals["issues"]
    )

    organization_view = await service.get_related_entities(
        first_id, relation_types=["affiliated_member"]
    )
    assert organization_view["items"][0]["entity"]["id"] == member_id
    assert organization_view["items"][0]["relationships"] == [
        {"type": "affiliated_member", "issue_area_ids": [], "source_ids": []}
    ]

    no_relation_filter = await service.get_related_entities(
        first_id, relation_types=["shared_source"]
    )
    related_ids = {item["entity"]["id"] for item in no_relation_filter["items"]}
    assert unrelated_id not in related_ids

    with pytest.raises(ValueError, match="Place profile not found"):
        await service.get_place_profile("Unknownville, ZZ")


@pytest.mark.asyncio
async def test_related_entities_can_link_by_shared_source_without_shared_issue_or_place(
    test_db: object,
    db_url: str,
) -> None:
    """Shared sources should still derive relationships when issue overlap and exact place match are absent."""
    primary_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Midwest Housing Table",
        description="Regional coordination body.",
        city=None,
        state="MO",
        region="Midwest",
        geo_specificity="regional",
    )
    related_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="St. Louis Health Coalition",
        description="Different issue focus in the same region.",
        city="St. Louis",
        state="MO",
        region="Midwest",
        geo_specificity="regional",
    )
    await test_db.executemany(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
        [
            (primary_id, "housing_affordability"),
            (related_id, "community_health_infrastructure"),
        ],
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/shared-regional-source",
        source_type="report",
        extraction_method="manual",
        title="Shared regional source",
    )
    await SourceCRUD.link_to_entry(test_db, primary_id, source_id, "regional housing context")
    await SourceCRUD.link_to_entry(test_db, related_id, source_id, "regional health context")
    await test_db.commit()

    service = AtlasDataService(db_url)
    relationships = await service.get_related_entities(primary_id, relation_types=["shared_source"])

    assert relationships["items"] == [
        {
            "entity": relationships["items"][0]["entity"],
            "relationships": [
                {
                    "type": "shared_source",
                    "issue_area_ids": [],
                    "source_ids": [source_id],
                }
            ],
        }
    ]
    assert relationships["items"][0]["entity"]["id"] == related_id


@pytest.mark.asyncio
async def test_catalog_model_helpers_cover_date_updates_filtered_queries_and_empty_metrics(
    test_db: object,
) -> None:
    """Catalog model helpers should cover remaining date, filtering, and empty-result branches."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Regional Housing Org",
        description="Regional housing organization used for helper coverage.",
        city="Kansas City",
        state="MO",
        region="Midwest",
        geo_specificity="regional",
    )
    await test_db.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, datetime('now'))",
        (entry_id, "housing_affordability"),
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/regional-housing",
        source_type="report",
        extraction_method="manual",
        title="Regional housing report",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id, "context")

    assert await SourceCRUD.update(test_db, source_id, published_date=date(2026, 4, 1))
    assert await EntryCRUD.update(test_db, entry_id, last_verified=date(2026, 4, 2))

    filtered = await EntryCRUD.search_public(
        test_db,
        regions=["Midwest"],
        issue_areas=["housing_affordability"],
        source_types=["report"],
    )
    assert filtered["total"] == 1
    assert filtered["entries"][0]["entry"].id == entry_id
    load_entries_with_metrics = EntryCRUD.__dict__["_load_entries_with_metrics"]
    build_facets = EntryCRUD.__dict__["_build_facets"]
    assert await load_entries_with_metrics(test_db, [], limit=10, offset=0) == []
    assert (
        await load_entries_with_metrics(
            test_db,
            ["missing-entry"],
            limit=10,
            offset=0,
        )
        == []
    )
    assert await build_facets(test_db, []) == _empty_facets()


def test_main_serve_uses_current_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ASGI serve entrypoint should pass through host, port, and reload settings."""
    called: dict[str, object] = {}

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(
            database_url="sqlite:///atlas.db",
            environment="dev",
            host="127.0.0.1",
            port=9000,
            log_level="debug",
        ),
    )
    monkeypatch.setattr(
        main_module.uvicorn,
        "run",
        lambda app_path, **kwargs: called.update({"app_path": app_path, **kwargs}),
    )

    main_module.serve()

    assert called == {
        "app_path": "atlas.main:app",
        "host": "127.0.0.1",
        "port": 9000,
        "reload": True,
        "log_level": "debug",
    }
