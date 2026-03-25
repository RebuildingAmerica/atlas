"""Shared test fixtures."""

import tempfile
from datetime import date

import httpx
import pytest
import pytest_asyncio

from atlas.config import Settings, get_settings
from atlas.main import create_app
from atlas.models import (
    DiscoveryRunCRUD,
    EntryCRUD,
    SourceCRUD,
    get_db_connection,
    init_db,
)


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
    )


@pytest_asyncio.fixture
async def test_client(test_settings: Settings) -> object:
    """Create a test client for the FastAPI app."""
    # Override get_settings dependency
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    app.dependency_overrides[get_settings] = override_get_settings

    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
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
