"""Shared test fixtures."""

import os

# ``atlas.main`` builds the app at import time, which validates auth config.
# That validation has no environment-based exemption any more, so name the one
# thing it keys on. Every test that exercises request handling supplies its own
# Settings through the ``get_settings`` dependency override below, so this only
# governs the import-time construction.
#
# Deliberately no auth URLs here: a populated ATLAS_AUTH_MEMBERSHIP_URL sends the
# suite out over the network to verify memberships, which is the failure
# 74306533 fixed when it came from a developer's env file.
os.environ.setdefault("ATLAS_MULTI_USER", "false")
# Paired with the line above: a single-operator instance is one nobody sells
# access to, so it has no catalog and no tiers. That is a real product shape;
# managed-and-single-user is not. Tests exercising Atlas's own commercial
# surfaces — paid plans, their quotas, staff review — say managed=True
# themselves.
os.environ.setdefault("ATLAS_MANAGED", "false")

import tempfile  # noqa: E402
import uuid  # noqa: E402
from collections.abc import AsyncIterator, Iterator  # noqa: E402
from datetime import UTC, date, datetime, timedelta  # noqa: E402
from urllib.parse import urlsplit, urlunsplit  # noqa: E402

import httpx  # noqa: E402
import psycopg  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from psycopg import sql  # noqa: E402

from atlas.config import Settings, get_settings  # noqa: E402
from atlas.domains.catalog.models.entry import EntryCRUD  # noqa: E402
from atlas.domains.catalog.models.source import SourceCRUD  # noqa: E402
from atlas.domains.moderation.models import FlagCRUD  # noqa: E402
from atlas.main import create_app  # noqa: E402
from atlas.models import (  # noqa: E402
    DiscoveryRunCRUD,
    get_db_connection,
    init_db,
)
from atlas.platform import config as platform_config  # noqa: E402
from atlas.platform.mcp import data as data_module  # noqa: E402
from atlas.platform.mcp.data import AtlasDataService  # noqa: E402

pytest_plugins = [
    "tests.domains.catalog.org_resources_support",
    "tests.domains.discovery.org_briefs_support",
    "tests.domains.discovery.schedule_support",
    "tests.domains.discovery.org_coverage_targets_support",
    "tests.domains.discovery.api_org_support",
]


@pytest.fixture(scope="session", autouse=True)
def hermetic_settings() -> Iterator[None]:
    """Run the suite against declared defaults instead of a developer's ``.env``.

    ``get_settings`` layers ``api/.env`` over the process environment so a local
    API server picks up developer overrides. That file is gitignored, so it
    exists on laptops and never in CI, and letting it reach the suite makes
    tests pass or fail depending on whose machine they run on. It sets
    ``ATLAS_AUTH_MEMBERSHIP_URL``, for one, which flips organization membership
    verification from "skipped because unconfigured" to a live HTTPS call
    against a development certificate. Pinning the env file off keeps every run
    hermetic and matches what CI sees.

    Yields
    ------
    None
        For the duration of the test session.
    """
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(platform_config, "API_ENV_FILE", None)
        # The suite exercises a dev-hardening API. Tests that need hosted
        # strictness name the profile they are testing themselves.
        yield


@pytest.fixture
def tmp_db_path() -> str:
    """Create a temporary database file path."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        return f.name


@pytest_asyncio.fixture
async def db_url(tmp_db_path: str) -> AsyncIterator[str]:
    """Create and initialize a test database.

    Runs against PostgreSQL whenever ``ATLAS_TEST_POSTGRES_URL`` names a server,
    which is what CI provides, and SQLite otherwise so a contributor needs no
    local database. Production runs PostgreSQL, and a suite that only ever ran
    SQLite is why row-shape divergences — dates arriving as objects rather than
    strings, ``INSERT OR`` forms, integer booleans — reached readers before
    anyone saw them.

    Each run gets its own database so tests stay isolated.
    """
    # Opt-in until the suite is green on PostgreSQL. CI already sets
    # ATLAS_TEST_POSTGRES_URL for the targeted Postgres lane, so keying the
    # whole-suite switch on that variable alone would turn the remaining
    # SQLite-isms into a red build rather than a migration in progress.
    base_url = os.getenv("ATLAS_TEST_POSTGRES_URL") if _postgres_requested() else None
    if not base_url:
        sqlite_url = f"sqlite:///{tmp_db_path}"
        await init_db(sqlite_url, backend="sqlite")
        yield sqlite_url
        return

    parsed = urlsplit(base_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        pytest.fail("ATLAS_TEST_POSTGRES_URL must be a PostgreSQL URL")

    database_name = f"atlas_test_{uuid.uuid4().hex}"
    postgres_url = urlunsplit(parsed._replace(path=f"/{database_name}"))
    admin = await psycopg.AsyncConnection.connect(base_url, autocommit=True)
    try:
        await admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
        await init_db(postgres_url, backend="postgres")
        yield postgres_url
    finally:
        await admin.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(database_name))
        )
        await admin.close()


def _postgres_requested() -> bool:
    """Return whether the suite should run against PostgreSQL.

    Set ``ATLAS_TEST_BACKEND=postgres`` alongside ``ATLAS_TEST_POSTGRES_URL``.
    Production runs PostgreSQL, so this is where the suite is headed; it is
    explicit only while the remaining SQLite-only SQL is migrated.

    Returns
    -------
    bool
        True when PostgreSQL was explicitly requested.
    """
    return os.getenv("ATLAS_TEST_BACKEND", "").strip().lower() == "postgres"


def _backend_for(database_url: str) -> str:
    """Return the backend selector matching a database URL.

    Parameters
    ----------
    database_url
        The URL under test.

    Returns
    -------
    str
        ``postgres`` or ``sqlite``.
    """
    return "postgres" if database_url.startswith(("postgres://", "postgresql://")) else "sqlite"


@pytest_asyncio.fixture
async def test_db(db_url: str) -> object:
    """Get a test database connection."""
    conn = await get_db_connection(db_url, backend=_backend_for(db_url))
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
def test_settings(db_url: str) -> Settings:
    """Create test settings with temporary database."""
    return Settings(
        database_url=db_url,
        database_backend=_backend_for(db_url),
        anthropic_api_key="test-key",
        environment="dev",
        cors_origins=["http://localhost:3000"],
        multi_user=False,  # Disable auth for testing
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
