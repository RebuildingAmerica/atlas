"""Shared test fixtures."""

import tempfile
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
import pytest_asyncio

from atlas.config import Settings, get_settings
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.source import SourceCRUD
from atlas.domains.moderation.models import FlagCRUD
from atlas.main import create_app
from atlas.models import (
    DiscoveryRunCRUD,
    get_db_connection,
    init_db,
)
from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import AtlasDataService


@pytest.fixture
def tmp_db_path() -> str:
    """Create a temporary database file path."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        return f.name


@pytest_asyncio.fixture
async def db_url(tmp_db_path: str) -> str:
    """Create and initialize a test database."""
    db_url = f"sqlite:///{tmp_db_path}"
    await init_db(db_url)
    return db_url


@pytest_asyncio.fixture
async def test_db(db_url: str) -> object:
    """Get a test database connection."""
    conn = await get_db_connection(db_url)
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
def test_settings(db_url: str) -> Settings:
    """Create test settings with temporary database."""
    return Settings(
        database_url=db_url,
        anthropic_api_key="test-key",
        environment="dev",
        cors_origins=["http://localhost:3000"],
        deploy_mode="local",  # Disable auth for testing
        discovery_inline=True,  # Run discovery synchronously in tests
    )


@pytest_asyncio.fixture
async def test_client(test_settings: Settings) -> object:
    """Create a test client for the FastAPI app."""
    # Override get_settings dependency
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    app.dependency_overrides[get_settings] = override_get_settings

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def sample_entry(test_db: object) -> str:
    """Create a sample entry in the test database."""
    return await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Test Organization",
        description="A test organization working on housing issues.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        website="https://example.com",
        email="info@example.com",
    )


@pytest_asyncio.fixture
async def sample_source(test_db: object) -> str:
    """Create a sample source in the test database."""
    return await SourceCRUD.create(
        test_db,
        url="https://example.com/article",
        source_type="news_article",
        extraction_method="manual",
        title="Test Article",
        publication="Test Publication",
        published_date=date(2026, 1, 15),
    )


@pytest_asyncio.fixture
async def sample_discovery_run(test_db: object) -> str:
    """Create a sample discovery run in the test database."""
    return await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability", "worker_cooperatives"],
    )


@pytest_asyncio.fixture
async def populated_service(db_url: str, test_db: object) -> object:
    """Build an AtlasDataService backed by a populated test database."""
    conn = test_db
    primary_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Atlas Primary Org",
        description="Primary org for MCP data coverage.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        website="https://primary.example",
    )
    related_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Atlas Related Org",
        description="Related org sharing place and issues.",
        city="Gary",
        state="IN",
        geo_specificity="local",
        affiliated_org_id=primary_id,
    )
    await EntryCRUD.update(conn, primary_id, verified=True)

    iso_now = datetime.now(UTC).isoformat()
    for entry_id in (primary_id, related_id):
        await conn.execute(
            "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
            (entry_id, "housing_affordability", iso_now),
        )
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
        (primary_id, "worker_cooperatives", iso_now),
    )
    await conn.commit()

    fresh_source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/fresh",
        source_type="news_article",
        extraction_method="manual",
        title="Fresh article",
        publication="Example Times",
        published_date=date.today(),  # noqa: DTZ011
    )
    aging_source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/aging",
        source_type="report",
        extraction_method="manual",
        title="Aging report",
        publication="Example Journal",
        published_date=date.today() - timedelta(days=data_module.FRESHNESS_DAYS + 30),  # noqa: DTZ011
    )
    await SourceCRUD.link_to_entry(
        conn, primary_id, fresh_source_id, extraction_context="primary fresh"
    )
    await SourceCRUD.link_to_entry(conn, related_id, fresh_source_id)
    await SourceCRUD.link_to_entry(conn, primary_id, aging_source_id)
    await conn.commit()

    await FlagCRUD.create_entity_flag(conn, entity_id=primary_id, reason="duplicate")
    await FlagCRUD.create_source_flag(conn, source_id=fresh_source_id, reason="incorrect")

    return AtlasDataService(db_url)
