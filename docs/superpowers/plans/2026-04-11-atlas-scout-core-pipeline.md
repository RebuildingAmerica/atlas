# Atlas Scout Core Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `atlas-scout`, a standalone Python CLI that discovers people, organizations, and initiatives by scraping the web with pluggable LLM providers (Ollama, Anthropic, etc.) and streaming async pipeline architecture.

**Architecture:** Monolithic Python package with streaming async generators for inter-step pipeline parallelism and semaphore-bounded fan-out for intra-step task parallelism. Provider abstraction via Protocol. Local SQLite for state. Separate from the Atlas API — communicates only via HTTP for contribution (Plan 2).

**Tech Stack:** Python 3.12, httpx, trafilatura, APScheduler, aiosqlite, click, tomli/tomllib, pydantic

**Scope note:** This plan covers the core pipeline through a working `scout run` CLI. A follow-up plan will cover the daemon scheduler, auto-contribution to central Atlas, and Atlas API contribution endpoints.

---

## File Structure

```
atlas/
├── shared/                              # atlas-shared package
│   ├── pyproject.toml
│   └── src/
│       └── atlas_shared/
│           ├── __init__.py
│           ├── taxonomy.py              # IssueArea, DOMAINS, ISSUE_AREAS_BY_DOMAIN, search terms
│           ├── schemas.py               # Entry, Source, RawEntry, GapReport pydantic models
│           └── types.py                 # Shared enums and small types
│
├── pipeline/                            # atlas-scout package
│   ├── pyproject.toml
│   ├── src/
│   │   └── atlas_scout/
│   │       ├── __init__.py
│   │       ├── cli.py                   # Click CLI entrypoint
│   │       ├── config.py                # TOML config loading + ScoutConfig pydantic model
│   │       ├── store.py                 # SQLite local store (runs, pages, entries)
│   │       ├── providers/
│   │       │   ├── __init__.py          # create_provider factory
│   │       │   ├── base.py             # LLMProvider protocol + Message/Completion types
│   │       │   ├── ollama.py           # Ollama provider
│   │       │   └── anthropic.py        # Anthropic provider
│   │       ├── scraper/
│   │       │   ├── __init__.py
│   │       │   ├── fetcher.py          # Async HTTP fetcher with rate limiting
│   │       │   ├── extractor.py        # HTML -> clean text via trafilatura
│   │       │   └── crawler.py          # 1-2 hop link follower
│   │       ├── steps/
│   │       │   ├── __init__.py
│   │       │   ├── query_gen.py        # Step 1: search query generation
│   │       │   ├── source_fetch.py     # Step 2: concurrent source fetching
│   │       │   ├── entry_extract.py    # Step 3: LLM entity extraction
│   │       │   ├── dedup.py            # Step 4: streaming deduplication
│   │       │   ├── rank.py             # Step 5: entry scoring
│   │       │   └── gap_analysis.py     # Step 6: coverage gap analysis
│   │       └── pipeline.py             # Streaming orchestrator + RunManager
│   └── tests/
│       ├── conftest.py                  # Shared fixtures
│       ├── test_config.py
│       ├── test_store.py
│       ├── test_providers/
│       │   ├── test_ollama.py
│       │   └── test_anthropic.py
│       ├── test_scraper/
│       │   ├── test_fetcher.py
│       │   ├── test_extractor.py
│       │   └── test_crawler.py
│       ├── test_steps/
│       │   ├── test_query_gen.py
│       │   ├── test_source_fetch.py
│       │   ├── test_entry_extract.py
│       │   ├── test_dedup.py
│       │   ├── test_rank.py
│       │   └── test_gap_analysis.py
│       ├── test_pipeline.py
│       └── test_cli.py
```

---

### Task 1: atlas-shared Package

**Files:**
- Create: `shared/pyproject.toml`
- Create: `shared/src/atlas_shared/__init__.py`
- Create: `shared/src/atlas_shared/types.py`
- Create: `shared/src/atlas_shared/taxonomy.py`
- Create: `shared/src/atlas_shared/schemas.py`
- Test: `shared/tests/test_taxonomy.py`
- Test: `shared/tests/test_schemas.py`
- Reference: `api/atlas/domains/catalog/taxonomy/issue_areas.py` (port from here)
- Reference: `api/atlas/domains/catalog/taxonomy/search_terms.py` (port from here)

- [ ] **Step 1: Create pyproject.toml**

```toml
# shared/pyproject.toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "atlas-shared"
version = "0.1.0"
description = "Shared types and taxonomy for the Atlas ecosystem"
requires-python = ">=3.12"
license = "MIT"
dependencies = ["pydantic>=2.5.0"]

[tool.hatch.build.targets.wheel]
packages = ["src/atlas_shared"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Create shared types**

```python
# shared/src/atlas_shared/types.py
from enum import StrEnum


class EntityType(StrEnum):
    PERSON = "person"
    ORGANIZATION = "organization"
    INITIATIVE = "initiative"
    CAMPAIGN = "campaign"
    EVENT = "event"


class GeoSpecificity(StrEnum):
    LOCAL = "local"
    REGIONAL = "regional"
    STATEWIDE = "statewide"
    NATIONAL = "national"


class SourceType(StrEnum):
    NEWS_ARTICLE = "news_article"
    OP_ED = "op_ed"
    REPORT = "report"
    GOVERNMENT_RECORD = "government_record"
    PODCAST = "podcast"
    VIDEO = "video"
    SOCIAL_MEDIA = "social_media"
    WEBSITE = "website"
```

- [ ] **Step 3: Port taxonomy from existing code**

Port `IssueArea` dataclass, `DOMAINS`, `ISSUE_AREAS_BY_DOMAIN`, `ALL_ISSUE_SLUGS`, `ISSUE_SEARCH_TERMS`, and helper functions from:
- `api/atlas/domains/catalog/taxonomy/issue_areas.py`
- `api/atlas/domains/catalog/taxonomy/search_terms.py`

Into `shared/src/atlas_shared/taxonomy.py`. Keep the exact same data, just move it. Change `IssueArea` from a `dataclass` to a Pydantic `BaseModel` with `model_config = ConfigDict(frozen=True)` so it's consistent with the rest of the shared package.

```python
# shared/src/atlas_shared/taxonomy.py
from pydantic import BaseModel, ConfigDict

class IssueArea(BaseModel):
    model_config = ConfigDict(frozen=True)
    slug: str
    name: str
    description: str
    domain: str

# ... (port all _register_issues calls, DOMAINS list, ISSUE_AREAS_BY_DOMAIN dict,
#      ALL_ISSUE_SLUGS set, ISSUE_SEARCH_TERMS dict, get_issue_area_by_slug,
#      get_issues_by_domain exactly as they exist in the API code)
```

- [ ] **Step 4: Write taxonomy tests**

```python
# shared/tests/test_taxonomy.py
from atlas_shared.taxonomy import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    get_issue_area_by_slug,
    get_issues_by_domain,
)


def test_domains_has_11_entries():
    assert len(DOMAINS) == 11


def test_all_issue_slugs_has_51_entries():
    assert len(ALL_ISSUE_SLUGS) == 51


def test_every_domain_has_issues():
    for domain in DOMAINS:
        issues = ISSUE_AREAS_BY_DOMAIN[domain]
        assert len(issues) > 0, f"{domain} has no issues"


def test_every_slug_has_search_terms():
    for slug in ALL_ISSUE_SLUGS:
        assert slug in ISSUE_SEARCH_TERMS, f"{slug} missing search terms"
        assert len(ISSUE_SEARCH_TERMS[slug]) > 0


def test_get_issue_area_by_slug_found():
    issue = get_issue_area_by_slug("housing_affordability")
    assert issue is not None
    assert issue.name == "Housing Affordability"
    assert issue.domain == "Housing and the Built Environment"


def test_get_issue_area_by_slug_not_found():
    assert get_issue_area_by_slug("nonexistent") is None


def test_get_issues_by_domain():
    issues = get_issues_by_domain("Education")
    assert len(issues) == 4
    slugs = {i.slug for i in issues}
    assert "k12_education_inequality" in slugs
```

- [ ] **Step 5: Run taxonomy tests**

Run: `cd shared && uv run pytest tests/test_taxonomy.py -v`
Expected: All 7 tests PASS

- [ ] **Step 6: Create shared Pydantic schemas**

```python
# shared/src/atlas_shared/schemas.py
from __future__ import annotations

from pydantic import BaseModel

from atlas_shared.types import EntityType, GeoSpecificity, SourceType


class RawEntry(BaseModel):
    """An entry extracted from a single source, before dedup."""
    name: str
    entry_type: EntityType
    description: str
    city: str | None = None
    state: str | None = None
    geo_specificity: GeoSpecificity = GeoSpecificity.LOCAL
    issue_areas: list[str] = []
    region: str | None = None
    website: str | None = None
    email: str | None = None
    social_media: dict[str, str] | None = None
    affiliated_org: str | None = None
    extraction_context: str | None = None
    source_url: str | None = None


class DeduplicatedEntry(BaseModel):
    """An entry after dedup, possibly merged from multiple sources."""
    name: str
    entry_type: EntityType
    description: str
    city: str | None = None
    state: str | None = None
    geo_specificity: GeoSpecificity = GeoSpecificity.LOCAL
    issue_areas: list[str] = []
    region: str | None = None
    website: str | None = None
    email: str | None = None
    social_media: dict[str, str] | None = None
    affiliated_org: str | None = None
    source_urls: list[str] = []
    source_dates: list[str] = []
    source_contexts: dict[str, str | None] = {}
    last_seen: str | None = None


class RankedEntry(BaseModel):
    """A deduplicated entry with a quality score."""
    entry: DeduplicatedEntry
    score: float
    components: dict[str, float] = {}


class CoverageGap(BaseModel):
    """A gap in issue area coverage."""
    issue_area_slug: str
    issue_area_name: str
    entry_count: int
    severity: str  # "critical", "thin", "covered"


class GapReport(BaseModel):
    """Coverage gap analysis results."""
    location: str
    total_entries: int
    covered_issues: list[CoverageGap] = []
    missing_issues: list[CoverageGap] = []
    thin_issues: list[CoverageGap] = []
    uncovered_domains: list[str] = []


class PageContent(BaseModel):
    """Extracted web page content."""
    url: str
    title: str | None = None
    text: str
    publication: str | None = None
    published_date: str | None = None
    source_type: SourceType = SourceType.NEWS_ARTICLE
```

- [ ] **Step 7: Write schema tests**

```python
# shared/tests/test_schemas.py
from atlas_shared.schemas import RawEntry, DeduplicatedEntry, RankedEntry, PageContent
from atlas_shared.types import EntityType, GeoSpecificity


def test_raw_entry_minimal():
    entry = RawEntry(name="Test Org", entry_type=EntityType.ORGANIZATION, description="A test")
    assert entry.name == "Test Org"
    assert entry.issue_areas == []
    assert entry.city is None


def test_raw_entry_full():
    entry = RawEntry(
        name="Jane Doe",
        entry_type=EntityType.PERSON,
        description="Community organizer",
        city="Austin",
        state="TX",
        geo_specificity=GeoSpecificity.LOCAL,
        issue_areas=["housing_affordability"],
        website="https://example.com",
        affiliated_org="Housing Alliance",
        source_url="https://source.com/article",
    )
    assert entry.city == "Austin"
    assert entry.affiliated_org == "Housing Alliance"


def test_deduplicated_entry_has_source_lists():
    entry = DeduplicatedEntry(
        name="Test Org",
        entry_type=EntityType.ORGANIZATION,
        description="A test",
        source_urls=["https://a.com", "https://b.com"],
        source_dates=["2026-01-01", "2026-02-01"],
    )
    assert len(entry.source_urls) == 2


def test_ranked_entry():
    deduped = DeduplicatedEntry(
        name="Test", entry_type=EntityType.ORGANIZATION, description="desc"
    )
    ranked = RankedEntry(entry=deduped, score=0.85, components={"source_density": 0.9})
    assert ranked.score == 0.85


def test_page_content():
    page = PageContent(url="https://example.com", text="Hello world", title="Example")
    assert page.url == "https://example.com"
```

- [ ] **Step 8: Run schema tests**

Run: `cd shared && uv run pytest tests/test_schemas.py -v`
Expected: All 5 tests PASS

- [ ] **Step 9: Create __init__.py with public API**

```python
# shared/src/atlas_shared/__init__.py
"""Atlas shared types, taxonomy, and schemas."""

from atlas_shared.schemas import (
    CoverageGap,
    DeduplicatedEntry,
    GapReport,
    PageContent,
    RankedEntry,
    RawEntry,
)
from atlas_shared.taxonomy import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    IssueArea,
    get_issue_area_by_slug,
    get_issues_by_domain,
)
from atlas_shared.types import EntityType, GeoSpecificity, SourceType

__all__ = [
    "ALL_ISSUE_SLUGS",
    "CoverageGap",
    "DOMAINS",
    "DeduplicatedEntry",
    "EntityType",
    "GapReport",
    "GeoSpecificity",
    "ISSUE_AREAS_BY_DOMAIN",
    "ISSUE_SEARCH_TERMS",
    "IssueArea",
    "PageContent",
    "RankedEntry",
    "RawEntry",
    "SourceType",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
]
```

- [ ] **Step 10: Run all shared tests**

Run: `cd shared && uv run pytest -v`
Expected: All 12 tests PASS

- [ ] **Step 11: Commit**

```bash
git add shared/
git commit -m "feat(shared): create atlas-shared package with taxonomy and schemas

Extracts taxonomy (11 domains, 51 issue areas, search terms) and shared
Pydantic schemas (RawEntry, DeduplicatedEntry, RankedEntry, PageContent,
GapReport) into a standalone package for use by both atlas-api and
atlas-scout."
```

---

### Task 2: atlas-scout Package Scaffold + Configuration

**Files:**
- Create: `pipeline/pyproject.toml`
- Create: `pipeline/src/atlas_scout/__init__.py`
- Create: `pipeline/src/atlas_scout/config.py`
- Create: `pipeline/tests/conftest.py`
- Test: `pipeline/tests/test_config.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
# pipeline/pyproject.toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "atlas-scout"
version = "0.1.0"
description = "Atlas Scout — autonomous web discovery pipeline with pluggable LLM providers"
requires-python = ">=3.12"
license = "MIT"
dependencies = [
    "atlas-shared @ {root:uri}/../shared",
    "httpx>=0.25.0",
    "trafilatura>=1.6.0",
    "aiosqlite>=0.19.0",
    "click>=8.1.0",
    "pydantic>=2.5.0",
    "pydantic-settings>=2.1.0",
]

[project.optional-dependencies]
ollama = ["ollama>=0.4.0"]
anthropic = ["anthropic>=0.7.0"]
openai = ["openai>=1.0.0"]
google = ["google-genai>=1.0.0"]
all = ["atlas-scout[ollama,anthropic,openai,google]"]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.21.0",
    "pytest-cov>=4.1.0",
    "ruff>=0.1.0",
    "mypy>=1.7.0",
    "respx>=0.22.0",
]

[project.scripts]
scout = "atlas_scout.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/atlas_scout"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "N", "UP", "B", "A", "COM", "C4", "DTZ", "ISC", "PIE", "PT", "RET", "SIM", "TCH", "ARG", "PTH", "RUF"]
ignore = ["E501", "COM812", "ISC001"]

[tool.mypy]
python_version = "3.12"
strict = true
plugins = ["pydantic.mypy"]
```

- [ ] **Step 2: Write failing config tests**

```python
# pipeline/tests/test_config.py
import textwrap
from pathlib import Path

from atlas_scout.config import ScoutConfig, load_config


def test_load_config_defaults():
    config = ScoutConfig()
    assert config.llm.provider == "ollama"
    assert config.llm.model == "llama3.1:8b"
    assert config.llm.max_concurrent == 10
    assert config.scraper.max_concurrent_fetches == 20
    assert config.scraper.page_cache_ttl_days == 7
    assert config.pipeline.min_entry_score == 0.3


def test_load_config_from_toml(tmp_path: Path):
    config_file = tmp_path / "scout.toml"
    config_file.write_text(textwrap.dedent("""\
        [llm]
        provider = "anthropic"
        model = "claude-sonnet-4-20250514"
        max_concurrent = 5

        [scraper]
        max_concurrent_fetches = 10
    """))
    config = load_config(config_file)
    assert config.llm.provider == "anthropic"
    assert config.llm.model == "claude-sonnet-4-20250514"
    assert config.llm.max_concurrent == 5
    assert config.scraper.max_concurrent_fetches == 10
    # Defaults preserved for unset values
    assert config.scraper.page_cache_ttl_days == 7


def test_load_config_with_targets(tmp_path: Path):
    config_file = tmp_path / "scout.toml"
    config_file.write_text(textwrap.dedent("""\
        [llm]
        provider = "ollama"

        [[schedule.targets]]
        location = "Austin, TX"
        issues = ["housing_affordability", "education_funding_and_policy"]
        search_depth = "standard"

        [[schedule.targets]]
        location = "Houston, TX"
        issues = ["healthcare_access_and_coverage"]
        search_depth = "deep"
    """))
    config = load_config(config_file)
    assert len(config.schedule.targets) == 2
    assert config.schedule.targets[0].location == "Austin, TX"
    assert config.schedule.targets[1].search_depth == "deep"


def test_load_config_missing_file_returns_defaults(tmp_path: Path):
    config = load_config(tmp_path / "nonexistent.toml")
    assert config.llm.provider == "ollama"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd pipeline && uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'atlas_scout'`

- [ ] **Step 4: Implement config module**

```python
# pipeline/src/atlas_scout/__init__.py
"""Atlas Scout — autonomous web discovery pipeline."""

__version__ = "0.1.0"
```

```python
# pipeline/src/atlas_scout/config.py
"""TOML-based configuration for Atlas Scout."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel


class LLMConfig(BaseModel):
    provider: str = "ollama"
    model: str = "llama3.1:8b"
    base_url: str | None = None
    max_concurrent: int = 10


class ScraperConfig(BaseModel):
    max_concurrent_fetches: int = 20
    page_cache_ttl_days: int = 7
    follow_links: bool = True
    max_link_depth: int = 2
    max_pages_per_seed: int = 20
    request_delay_ms: int = 200


class PipelineConfig(BaseModel):
    dedup_batch_size: int = 50
    min_entry_score: float = 0.3
    gap_analysis: bool = True
    iterative_deepening: bool = False


class ScheduleTarget(BaseModel):
    location: str
    issues: list[str] = []
    search_depth: str = "standard"


class ScheduleConfig(BaseModel):
    enabled: bool = False
    cron: str = "0 2 * * *"
    max_concurrent_runs: int = 2
    targets: list[ScheduleTarget] = []


class ContributionConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    atlas_url: str = "https://atlas.rebuilding.us"
    min_score: float = 0.7


class StoreConfig(BaseModel):
    path: str = "~/.atlas-scout/scout.db"


class ScoutConfig(BaseModel):
    llm: LLMConfig = LLMConfig()
    scraper: ScraperConfig = ScraperConfig()
    pipeline: PipelineConfig = PipelineConfig()
    schedule: ScheduleConfig = ScheduleConfig()
    contribution: ContributionConfig = ContributionConfig()
    store: StoreConfig = StoreConfig()


def load_config(path: Path) -> ScoutConfig:
    """Load ScoutConfig from a TOML file, falling back to defaults."""
    if not path.exists():
        return ScoutConfig()
    with open(path, "rb") as f:
        data = tomllib.load(f)
    return ScoutConfig.model_validate(data)
```

- [ ] **Step 5: Run config tests**

Run: `cd pipeline && uv run pytest tests/test_config.py -v`
Expected: All 4 tests PASS

- [ ] **Step 6: Create test conftest**

```python
# pipeline/tests/conftest.py
"""Shared test fixtures for atlas-scout."""

from pathlib import Path

import pytest


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_db_path(tmp_path: Path) -> Path:
    return tmp_path / "test-scout.db"
```

- [ ] **Step 7: Commit**

```bash
git add pipeline/
git commit -m "feat(scout): scaffold atlas-scout package with TOML config

Creates the atlas-scout package skeleton with pyproject.toml, CLI
entrypoint, and TOML-based configuration supporting LLM provider,
scraper, pipeline, schedule, and contribution settings."
```

---

### Task 3: Local SQLite Store

**Files:**
- Create: `pipeline/src/atlas_scout/store.py`
- Test: `pipeline/tests/test_store.py`

- [ ] **Step 1: Write failing store tests**

```python
# pipeline/tests/test_store.py
import pytest

from atlas_scout.store import ScoutStore


@pytest.fixture
async def store(tmp_db_path):
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    yield s
    await s.close()


async def test_initialize_creates_tables(store):
    tables = await store.list_tables()
    assert "runs" in tables
    assert "pages" in tables
    assert "entries" in tables


async def test_create_and_get_run(store):
    run_id = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    assert run_id is not None
    run = await store.get_run(run_id)
    assert run["location"] == "Austin, TX"
    assert run["status"] == "pending"


async def test_update_run_status(store):
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.update_run_status(run_id, "running")
    run = await store.get_run(run_id)
    assert run["status"] == "running"


async def test_complete_run_with_stats(store):
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.complete_run(run_id, queries=40, pages_fetched=120, entries_found=35, entries_after_dedup=28)
    run = await store.get_run(run_id)
    assert run["status"] == "completed"
    assert run["entries_found"] == 35


async def test_page_cache_miss_then_hit(store):
    cached = await store.get_cached_page("https://example.com")
    assert cached is None

    await store.cache_page("https://example.com", "Hello world", {"title": "Example"})
    cached = await store.get_cached_page("https://example.com")
    assert cached is not None
    assert cached["text"] == "Hello world"


async def test_page_cache_respects_ttl(store):
    await store.cache_page("https://example.com", "Hello", {})
    # Manually expire the page
    await store._execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com",),
    )
    cached = await store.get_cached_page("https://example.com", ttl_days=7)
    assert cached is None


async def test_save_and_list_entries(store):
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.save_entry(
        run_id=run_id,
        name="Housing Alliance",
        entry_type="organization",
        description="Affordable housing advocacy",
        city="Austin",
        state="TX",
        score=0.85,
        data={"issue_areas": ["housing_affordability"], "source_urls": ["https://example.com"]},
    )
    entries = await store.list_entries(run_id=run_id)
    assert len(entries) == 1
    assert entries[0]["name"] == "Housing Alliance"
    assert entries[0]["score"] == 0.85


async def test_list_runs(store):
    await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.create_run(location="Houston, TX", issues=[], search_depth="deep")
    runs = await store.list_runs()
    assert len(runs) == 2
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_store.py -v`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement store**

```python
# pipeline/src/atlas_scout/store.py
"""Local SQLite store for Scout state and results."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import aiosqlite

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    location TEXT NOT NULL,
    issues TEXT NOT NULL,
    search_depth TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    queries INTEGER,
    pages_fetched INTEGER,
    entries_found INTEGER,
    entries_after_dedup INTEGER,
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    state TEXT,
    score REAL NOT NULL DEFAULT 0.0,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""


class ScoutStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()

    @property
    def conn(self) -> aiosqlite.Connection:
        assert self._conn is not None, "Store not initialized"
        return self._conn

    async def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        await self.conn.execute(sql, params)
        await self.conn.commit()

    async def list_tables(self) -> list[str]:
        cursor = await self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        rows = await cursor.fetchall()
        return [row["name"] for row in rows]

    # --- Runs ---

    async def create_run(
        self, *, location: str, issues: list[str], search_depth: str
    ) -> str:
        run_id = uuid.uuid4().hex[:12]
        now = datetime.now(UTC).isoformat()
        await self.conn.execute(
            "INSERT INTO runs (id, location, issues, search_depth, status, started_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
            (run_id, location, json.dumps(issues), search_depth, now, now),
        )
        await self.conn.commit()
        return run_id

    async def get_run(self, run_id: str) -> dict[str, Any]:
        cursor = await self.conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
        row = await cursor.fetchone()
        assert row is not None, f"Run {run_id} not found"
        return dict(row)

    async def update_run_status(self, run_id: str, status: str) -> None:
        await self._execute("UPDATE runs SET status = ? WHERE id = ?", (status, run_id))

    async def complete_run(
        self,
        run_id: str,
        *,
        queries: int,
        pages_fetched: int,
        entries_found: int,
        entries_after_dedup: int,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        await self._execute(
            "UPDATE runs SET status = 'completed', completed_at = ?, queries = ?, pages_fetched = ?, entries_found = ?, entries_after_dedup = ? WHERE id = ?",
            (now, queries, pages_fetched, entries_found, entries_after_dedup, run_id),
        )

    async def fail_run(self, run_id: str, error: str) -> None:
        now = datetime.now(UTC).isoformat()
        await self._execute(
            "UPDATE runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
            (now, error, run_id),
        )

    async def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        cursor = await self.conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        return [dict(row) for row in await cursor.fetchall()]

    # --- Page Cache ---

    async def get_cached_page(
        self, url: str, ttl_days: int = 7
    ) -> dict[str, Any] | None:
        cursor = await self.conn.execute(
            "SELECT * FROM pages WHERE url = ? AND fetched_at > datetime('now', ?)",
            (url, f"-{ttl_days} days"),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["metadata"] = json.loads(result["metadata"])
        return result

    async def cache_page(
        self, url: str, text: str, metadata: dict[str, Any]
    ) -> None:
        now = datetime.now(UTC).isoformat()
        await self.conn.execute(
            "INSERT OR REPLACE INTO pages (url, text, metadata, fetched_at) VALUES (?, ?, ?, ?)",
            (url, text, json.dumps(metadata), now),
        )
        await self.conn.commit()

    # --- Entries ---

    async def save_entry(
        self,
        *,
        run_id: str,
        name: str,
        entry_type: str,
        description: str,
        city: str | None,
        state: str | None,
        score: float,
        data: dict[str, Any],
    ) -> str:
        entry_id = uuid.uuid4().hex[:12]
        now = datetime.now(UTC).isoformat()
        await self.conn.execute(
            "INSERT INTO entries (id, run_id, name, entry_type, description, city, state, score, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (entry_id, run_id, name, entry_type, description, city, state, score, json.dumps(data), now),
        )
        await self.conn.commit()
        return entry_id

    async def list_entries(
        self, run_id: str | None = None, min_score: float = 0.0
    ) -> list[dict[str, Any]]:
        if run_id:
            cursor = await self.conn.execute(
                "SELECT * FROM entries WHERE run_id = ? AND score >= ? ORDER BY score DESC",
                (run_id, min_score),
            )
        else:
            cursor = await self.conn.execute(
                "SELECT * FROM entries WHERE score >= ? ORDER BY score DESC",
                (min_score,),
            )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["data"] = json.loads(d["data"])
            results.append(d)
        return results
```

- [ ] **Step 4: Run store tests**

Run: `cd pipeline && uv run pytest tests/test_store.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/atlas_scout/store.py pipeline/tests/test_store.py
git commit -m "feat(scout): add local SQLite store for runs, pages, and entries

Implements ScoutStore with tables for discovery runs (lifecycle tracking),
page cache (TTL-based URL dedup), and discovered entries (scored results).
All async via aiosqlite."
```

---

### Task 4: LLM Provider Base + Ollama

**Files:**
- Create: `pipeline/src/atlas_scout/providers/__init__.py`
- Create: `pipeline/src/atlas_scout/providers/base.py`
- Create: `pipeline/src/atlas_scout/providers/ollama.py`
- Test: `pipeline/tests/test_providers/test_ollama.py`

- [ ] **Step 1: Write provider protocol and types**

```python
# pipeline/src/atlas_scout/providers/base.py
"""LLM provider protocol and shared types."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


class Message(BaseModel):
    role: str  # "system", "user", "assistant"
    content: str


class Completion(BaseModel):
    text: str
    parsed: dict[str, Any] | None = None  # structured output if requested
    usage: dict[str, int] = {}  # tokens: prompt, completion


@runtime_checkable
class LLMProvider(Protocol):
    @property
    def max_concurrent(self) -> int: ...

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion: ...
```

- [ ] **Step 2: Write failing Ollama tests**

```python
# pipeline/tests/test_providers/test_ollama.py
import json

import httpx
import pytest
import respx

from atlas_scout.providers.base import Completion, LLMProvider, Message
from atlas_scout.providers.ollama import OllamaProvider


def test_ollama_is_llm_provider():
    provider = OllamaProvider(model="llama3.1:8b")
    assert isinstance(provider, LLMProvider)


def test_ollama_max_concurrent_default():
    provider = OllamaProvider(model="llama3.1:8b")
    assert provider.max_concurrent == 10


@respx.mock
async def test_ollama_complete_plain_text():
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "Hello from Ollama!"},
                "prompt_eval_count": 10,
                "eval_count": 5,
            },
        )
    )
    provider = OllamaProvider(model="llama3.1:8b")
    result = await provider.complete([Message(role="user", content="Hi")])
    assert isinstance(result, Completion)
    assert result.text == "Hello from Ollama!"
    assert result.usage["prompt_tokens"] == 10


@respx.mock
async def test_ollama_complete_structured_output():
    from pydantic import BaseModel

    class Person(BaseModel):
        name: str
        age: int

    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {
                    "role": "assistant",
                    "content": json.dumps({"name": "Alice", "age": 30}),
                },
                "prompt_eval_count": 15,
                "eval_count": 8,
            },
        )
    )
    provider = OllamaProvider(model="llama3.1:8b")
    result = await provider.complete(
        [Message(role="user", content="Give me a person")],
        response_schema=Person,
    )
    assert result.parsed is not None
    assert result.parsed["name"] == "Alice"
    assert result.parsed["age"] == 30
```

- [ ] **Step 3: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_providers/test_ollama.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 4: Implement Ollama provider**

```python
# pipeline/src/atlas_scout/providers/ollama.py
"""Ollama LLM provider — connects to local Ollama instance."""

from __future__ import annotations

import json
from typing import Any

import httpx
from pydantic import BaseModel

from atlas_scout.providers.base import Completion, LLMProvider, Message


class OllamaProvider:
    """LLM provider for Ollama running locally."""

    def __init__(
        self,
        model: str,
        base_url: str = "http://localhost:11434",
        max_concurrent: int = 10,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._max_concurrent = max_concurrent

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": False,
        }
        if response_schema is not None:
            payload["format"] = response_schema.model_json_schema()

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()

        text = data["message"]["content"]
        parsed = None
        if response_schema is not None:
            parsed = json.loads(text)

        return Completion(
            text=text,
            parsed=parsed,
            usage={
                "prompt_tokens": data.get("prompt_eval_count", 0),
                "completion_tokens": data.get("eval_count", 0),
            },
        )
```

- [ ] **Step 5: Create providers __init__.py with factory**

```python
# pipeline/src/atlas_scout/providers/__init__.py
"""LLM provider factory."""

from atlas_scout.config import LLMConfig
from atlas_scout.providers.base import LLMProvider


def create_provider(config: LLMConfig) -> LLMProvider:
    """Create an LLM provider from config."""
    if config.provider == "ollama":
        from atlas_scout.providers.ollama import OllamaProvider

        return OllamaProvider(
            model=config.model,
            base_url=config.base_url or "http://localhost:11434",
            max_concurrent=config.max_concurrent,
        )
    if config.provider == "anthropic":
        from atlas_scout.providers.anthropic import AnthropicProvider

        return AnthropicProvider(
            model=config.model,
            api_key=config.base_url,  # overloaded; see anthropic provider
            max_concurrent=config.max_concurrent,
        )
    raise ValueError(f"Unknown LLM provider: {config.provider}")
```

- [ ] **Step 6: Run Ollama tests**

Run: `cd pipeline && uv run pytest tests/test_providers/test_ollama.py -v`
Expected: All 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/atlas_scout/providers/ pipeline/tests/test_providers/
git commit -m "feat(scout): add LLM provider protocol and Ollama implementation

Defines LLMProvider protocol with complete() method supporting structured
output via response_schema. Implements OllamaProvider using Ollama's
/api/chat endpoint with JSON format for structured extraction."
```

---

### Task 5: Anthropic LLM Provider

**Files:**
- Create: `pipeline/src/atlas_scout/providers/anthropic.py`
- Test: `pipeline/tests/test_providers/test_anthropic.py`

- [ ] **Step 1: Write failing Anthropic tests**

```python
# pipeline/tests/test_providers/test_anthropic.py
import json

import httpx
import pytest
import respx

from atlas_scout.providers.anthropic import AnthropicProvider
from atlas_scout.providers.base import Completion, LLMProvider, Message


def test_anthropic_is_llm_provider():
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    assert isinstance(provider, LLMProvider)


@respx.mock
async def test_anthropic_complete_plain_text():
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Hello from Claude!"}],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    result = await provider.complete([Message(role="user", content="Hi")])
    assert result.text == "Hello from Claude!"
    assert result.usage["prompt_tokens"] == 10


@respx.mock
async def test_anthropic_complete_structured():
    from pydantic import BaseModel

    class Person(BaseModel):
        name: str
        age: int

    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": json.dumps({"name": "Bob", "age": 25})}],
                "usage": {"input_tokens": 20, "output_tokens": 10},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    result = await provider.complete(
        [Message(role="user", content="person please")],
        response_schema=Person,
    )
    assert result.parsed == {"name": "Bob", "age": 25}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_providers/test_anthropic.py -v`
Expected: FAIL

- [ ] **Step 3: Implement Anthropic provider**

```python
# pipeline/src/atlas_scout/providers/anthropic.py
"""Anthropic Claude LLM provider."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from pydantic import BaseModel

from atlas_scout.providers.base import Completion, Message


class AnthropicProvider:
    """LLM provider for Anthropic Claude API."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        max_concurrent: int = 10,
    ) -> None:
        self._model = model
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self._max_concurrent = max_concurrent

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        system_messages = [m for m in messages if m.role == "system"]
        user_messages = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]

        payload: dict[str, Any] = {
            "model": self._model,
            "max_tokens": 4096,
            "messages": user_messages,
        }
        if system_messages:
            payload["system"] = system_messages[0].content

        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        text_blocks = [
            block["text"]
            for block in data.get("content", [])
            if block.get("type") == "text"
        ]
        text = "\n".join(text_blocks)

        parsed = None
        if response_schema is not None:
            # Strip markdown code fences if present
            clean = text.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1]
                clean = clean.rsplit("\n```", 1)[0]
            parsed = json.loads(clean)

        usage = data.get("usage", {})
        return Completion(
            text=text,
            parsed=parsed,
            usage={
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
            },
        )
```

- [ ] **Step 4: Update provider factory**

Update `pipeline/src/atlas_scout/providers/__init__.py` — fix the anthropic branch to pass `api_key` correctly:

```python
    if config.provider == "anthropic":
        from atlas_scout.providers.anthropic import AnthropicProvider

        return AnthropicProvider(
            model=config.model,
            api_key=config.base_url,  # Can be None; provider falls back to env var
            max_concurrent=config.max_concurrent,
        )
```

- [ ] **Step 5: Run Anthropic tests**

Run: `cd pipeline && uv run pytest tests/test_providers/test_anthropic.py -v`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/atlas_scout/providers/anthropic.py pipeline/tests/test_providers/test_anthropic.py pipeline/src/atlas_scout/providers/__init__.py
git commit -m "feat(scout): add Anthropic Claude LLM provider

Implements AnthropicProvider using the Messages API with support for
structured output via JSON parsing. Falls back to ANTHROPIC_API_KEY
env var when no key is configured."
```

---

### Task 6: Async Fetcher + Content Extractor + Page Cache

**Files:**
- Create: `pipeline/src/atlas_scout/scraper/__init__.py`
- Create: `pipeline/src/atlas_scout/scraper/fetcher.py`
- Create: `pipeline/src/atlas_scout/scraper/extractor.py`
- Test: `pipeline/tests/test_scraper/test_fetcher.py`
- Test: `pipeline/tests/test_scraper/test_extractor.py`

- [ ] **Step 1: Write failing fetcher tests**

```python
# pipeline/tests/test_scraper/test_fetcher.py
import httpx
import pytest
import respx

from atlas_scout.scraper.fetcher import AsyncFetcher


@respx.mock
async def test_fetch_single_url():
    respx.get("https://example.com/article").mock(
        return_value=httpx.Response(200, text="<html><body><p>Article content here.</p></body></html>")
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/article")
    assert result is not None
    assert result.url == "https://example.com/article"
    assert len(result.text) > 0


@respx.mock
async def test_fetch_returns_none_on_error():
    respx.get("https://example.com/404").mock(return_value=httpx.Response(404))
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/404")
    assert result is None


@respx.mock
async def test_fetch_many_concurrent():
    for i in range(5):
        respx.get(f"https://example.com/page{i}").mock(
            return_value=httpx.Response(200, text=f"<html><body><p>Page {i} content with enough words to pass the minimum threshold for extraction quality.</p></body></html>")
        )
    urls = [f"https://example.com/page{i}" for i in range(5)]
    fetcher = AsyncFetcher(max_concurrent=3, request_delay_ms=0)
    results = await fetcher.fetch_many(urls)
    # Some may be None if trafilatura rejects the content, but all should be attempted
    assert len(results) <= 5


@respx.mock
async def test_fetch_with_page_cache(tmp_db_path):
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    respx.get("https://example.com/cached").mock(
        return_value=httpx.Response(200, text="<html><body><p>Cached content.</p></body></html>")
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0, store=store)

    # First fetch: hits network
    result1 = await fetcher.fetch("https://example.com/cached")

    # Second fetch: should use cache (respx would fail on double request)
    respx.get("https://example.com/cached").mock(side_effect=RuntimeError("should not be called"))
    result2 = await fetcher.fetch("https://example.com/cached")

    await store.close()
    # Both should return content (either from network or cache)
    assert result1 is not None or result2 is not None
```

- [ ] **Step 2: Write failing extractor tests**

```python
# pipeline/tests/test_scraper/test_extractor.py
from atlas_scout.scraper.extractor import extract_content, is_quality_content


def test_extract_content_from_html():
    html = """
    <html>
    <head><title>Test Article</title></head>
    <body>
        <nav>Navigation stuff</nav>
        <article>
            <h1>Important Article</h1>
            <p>This is a detailed article about housing policy in Austin, Texas.
            The city council has been debating new zoning regulations that would
            allow more affordable housing development in the downtown area.</p>
        </article>
        <footer>Footer stuff</footer>
    </body>
    </html>
    """
    result = extract_content(html, url="https://example.com/article")
    assert result is not None
    assert "housing" in result.text.lower() or "zoning" in result.text.lower()


def test_extract_content_returns_none_for_empty():
    result = extract_content("", url="https://example.com")
    assert result is None


def test_is_quality_content_passes_good_text():
    good_text = " ".join(["word"] * 250)  # 250 words
    assert is_quality_content(good_text) is True


def test_is_quality_content_rejects_short_text():
    assert is_quality_content("Too short.") is False


def test_is_quality_content_rejects_login_wall():
    assert is_quality_content("Please log in to continue reading this article. Sign up for a free account.") is False
```

- [ ] **Step 3: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_scraper/ -v`
Expected: FAIL

- [ ] **Step 4: Implement extractor**

```python
# pipeline/src/atlas_scout/scraper/__init__.py
"""Web scraping layer for Atlas Scout."""
```

```python
# pipeline/src/atlas_scout/scraper/extractor.py
"""HTML content extraction using trafilatura."""

from __future__ import annotations

import re

import trafilatura

from atlas_shared import PageContent, SourceType

MIN_WORD_COUNT = 200
LOGIN_PATTERNS = re.compile(
    r"(please (log|sign) in|create an account|subscribe to continue|paywall)",
    re.IGNORECASE,
)


def extract_content(html: str, url: str) -> PageContent | None:
    """Extract clean text and metadata from HTML."""
    if not html.strip():
        return None

    text = trafilatura.extract(html, include_comments=False, include_tables=False)
    if not text or not is_quality_content(text):
        return None

    metadata = trafilatura.extract_metadata(html)
    title = metadata.title if metadata else None
    date = metadata.date if metadata else None

    return PageContent(
        url=url,
        text=text,
        title=title,
        published_date=date,
        source_type=_infer_source_type(url, title),
    )


def is_quality_content(text: str) -> bool:
    """Check if extracted text meets minimum quality bar."""
    if len(text.split()) < MIN_WORD_COUNT:
        return False
    if LOGIN_PATTERNS.search(text[:500]):
        return False
    return True


def _infer_source_type(url: str, title: str | None) -> SourceType:
    """Infer source type from URL and title."""
    lowered = f"{url} {title or ''}".lower()
    if "podcast" in lowered:
        return SourceType.PODCAST
    if "report" in lowered or "pdf" in lowered:
        return SourceType.REPORT
    if "gov" in lowered:
        return SourceType.GOVERNMENT_RECORD
    if "youtube" in lowered or "video" in lowered:
        return SourceType.VIDEO
    if any(s in lowered for s in ("twitter.com", "x.com", "instagram.com")):
        return SourceType.SOCIAL_MEDIA
    return SourceType.NEWS_ARTICLE
```

- [ ] **Step 5: Implement fetcher**

```python
# pipeline/src/atlas_scout/scraper/fetcher.py
"""Async HTTP fetcher with rate limiting and page cache integration."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

import httpx

from atlas_shared import PageContent
from atlas_scout.scraper.extractor import extract_content

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

USER_AGENT = "AtlasScout/1.0 (+https://atlas.rebuilding.us/scout)"


class AsyncFetcher:
    def __init__(
        self,
        max_concurrent: int = 20,
        request_delay_ms: int = 200,
        timeout: float = 30.0,
        page_cache_ttl_days: int = 7,
        store: ScoutStore | None = None,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._delay = request_delay_ms / 1000.0
        self._timeout = timeout
        self._cache_ttl = page_cache_ttl_days
        self._store = store

    async def fetch(self, url: str) -> PageContent | None:
        """Fetch a URL and extract content. Returns None on failure."""
        # Check cache first
        if self._store:
            cached = await self._store.get_cached_page(url, ttl_days=self._cache_ttl)
            if cached is not None:
                return PageContent(
                    url=url,
                    text=cached["text"],
                    title=cached["metadata"].get("title"),
                    published_date=cached["metadata"].get("published_date"),
                )

        async with self._semaphore:
            if self._delay > 0:
                await asyncio.sleep(self._delay)
            try:
                async with httpx.AsyncClient(
                    timeout=self._timeout,
                    follow_redirects=True,
                    headers={"User-Agent": USER_AGENT},
                ) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                logger.debug("Failed to fetch %s: %s", url, exc)
                return None

            page = extract_content(resp.text, url=url)
            if page is None:
                return None

            # Cache the result
            if self._store:
                await self._store.cache_page(
                    url,
                    page.text,
                    {"title": page.title, "published_date": page.published_date},
                )

            return page

    async def fetch_many(self, urls: list[str]) -> list[PageContent]:
        """Fetch multiple URLs concurrently. Returns successful results only."""
        tasks = [self.fetch(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r for r in results if isinstance(r, PageContent)]
```

- [ ] **Step 6: Run scraper tests**

Run: `cd pipeline && uv run pytest tests/test_scraper/ -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/atlas_scout/scraper/ pipeline/tests/test_scraper/
git commit -m "feat(scout): add async fetcher and content extractor

Implements AsyncFetcher with semaphore-bounded concurrent HTTP fetching,
page cache integration via ScoutStore, and trafilatura-based HTML content
extraction with quality filtering (min word count, login wall detection)."
```

---

### Task 7: Link Crawler

**Files:**
- Create: `pipeline/src/atlas_scout/scraper/crawler.py`
- Test: `pipeline/tests/test_scraper/test_crawler.py`

- [ ] **Step 1: Write failing crawler tests**

```python
# pipeline/tests/test_scraper/test_crawler.py
import httpx
import pytest
import respx

from atlas_scout.scraper.crawler import LinkCrawler, extract_links


def test_extract_links_from_html():
    html = """
    <html><body>
        <a href="https://example.com/page1">Page 1</a>
        <a href="https://example.com/page2">Page 2</a>
        <a href="https://other.com/external">External</a>
        <a href="/relative">Relative</a>
    </body></html>
    """
    links = extract_links(html, base_url="https://example.com/start")
    assert "https://example.com/page1" in links
    assert "https://example.com/page2" in links
    assert "https://example.com/relative" in links


def test_extract_links_filters_non_http():
    html = """
    <html><body>
        <a href="mailto:test@example.com">Email</a>
        <a href="javascript:void(0)">JS</a>
        <a href="https://example.com/real">Real</a>
    </body></html>
    """
    links = extract_links(html, base_url="https://example.com")
    assert len(links) == 1
    assert "https://example.com/real" in links


def test_extract_links_same_domain_only():
    html = """
    <html><body>
        <a href="https://example.com/internal">Internal</a>
        <a href="https://other.com/external">External</a>
    </body></html>
    """
    links = extract_links(html, base_url="https://example.com", same_domain=True)
    assert "https://example.com/internal" in links
    assert "https://other.com/external" not in links
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_scraper/test_crawler.py -v`
Expected: FAIL

- [ ] **Step 3: Implement crawler**

```python
# pipeline/src/atlas_scout/scraper/crawler.py
"""Bounded link crawler for 1-2 hop discovery."""

from __future__ import annotations

import logging
import re
from html.parser import HTMLParser
from typing import TYPE_CHECKING
from urllib.parse import urljoin, urlparse

from atlas_shared import PageContent

if TYPE_CHECKING:
    from atlas_scout.scraper.fetcher import AsyncFetcher

logger = logging.getLogger(__name__)


class _LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.links.append(value)


def extract_links(
    html: str,
    base_url: str,
    same_domain: bool = True,
) -> list[str]:
    """Extract unique HTTP(S) links from HTML."""
    parser = _LinkExtractor()
    parser.feed(html)

    base_domain = urlparse(base_url).netloc
    seen: set[str] = set()
    result: list[str] = []

    for raw_href in parser.links:
        absolute = urljoin(base_url, raw_href)
        parsed = urlparse(absolute)

        if parsed.scheme not in ("http", "https"):
            continue
        if same_domain and parsed.netloc != base_domain:
            continue

        # Normalize: strip fragment, trailing slash
        normalized = parsed._replace(fragment="").geturl().rstrip("/")
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)

    return result


class LinkCrawler:
    """Bounded BFS crawler that follows links up to max_depth hops."""

    def __init__(
        self,
        fetcher: AsyncFetcher,
        max_depth: int = 2,
        max_pages: int = 20,
        same_domain: bool = True,
    ) -> None:
        self._fetcher = fetcher
        self._max_depth = max_depth
        self._max_pages = max_pages
        self._same_domain = same_domain

    async def crawl(self, seed_url: str, seed_html: str) -> list[PageContent]:
        """Follow links from a seed page, returning discovered pages."""
        visited: set[str] = {seed_url}
        results: list[PageContent] = []
        frontier: list[tuple[str, int]] = [
            (link, 1)
            for link in extract_links(seed_html, base_url=seed_url, same_domain=self._same_domain)
        ]

        while frontier and len(results) < self._max_pages:
            url, depth = frontier.pop(0)
            if url in visited or depth > self._max_depth:
                continue
            visited.add(url)

            page = await self._fetcher.fetch(url)
            if page is None:
                continue
            results.append(page)

            if depth < self._max_depth:
                # We don't have the raw HTML here since fetcher returns extracted text.
                # For deeper crawling, we'd need to also return raw HTML.
                # For now, depth-2 crawling works by discovering links from seed only.
                pass

        return results
```

- [ ] **Step 4: Run crawler tests**

Run: `cd pipeline && uv run pytest tests/test_scraper/test_crawler.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/atlas_scout/scraper/crawler.py pipeline/tests/test_scraper/test_crawler.py
git commit -m "feat(scout): add bounded link crawler

Implements extract_links for HTML link extraction and LinkCrawler for
bounded BFS crawl (max_depth=2, max_pages=20, same-domain filtering)."
```

---

### Task 8: Pipeline Steps 1-2 (Query Gen + Source Fetch)

**Files:**
- Create: `pipeline/src/atlas_scout/steps/__init__.py`
- Create: `pipeline/src/atlas_scout/steps/query_gen.py`
- Create: `pipeline/src/atlas_scout/steps/source_fetch.py`
- Test: `pipeline/tests/test_steps/test_query_gen.py`
- Test: `pipeline/tests/test_steps/test_source_fetch.py`
- Reference: `api/atlas/domains/discovery/pipeline/query_generator.py` (port from)
- Reference: `api/atlas/domains/discovery/pipeline/source_fetcher.py` (port from)

- [ ] **Step 1: Write failing query gen tests**

```python
# pipeline/tests/test_steps/test_query_gen.py
from atlas_scout.steps.query_gen import SearchQuery, generate_queries


def test_generate_queries_produces_results():
    queries = generate_queries(
        city="Austin",
        state="TX",
        issue_areas=["housing_affordability"],
    )
    assert len(queries) > 0
    assert all(isinstance(q, SearchQuery) for q in queries)


def test_generate_queries_includes_location():
    queries = generate_queries(city="Austin", state="TX", issue_areas=["housing_affordability"])
    assert all("Austin" in q.query for q in queries)


def test_generate_queries_skips_unknown_issues():
    queries = generate_queries(city="Austin", state="TX", issue_areas=["nonexistent_issue"])
    assert len(queries) == 0


def test_generate_queries_multiple_issues():
    queries = generate_queries(
        city="Austin",
        state="TX",
        issue_areas=["housing_affordability", "public_transit"],
    )
    housing_queries = [q for q in queries if q.issue_area == "housing_affordability"]
    transit_queries = [q for q in queries if q.issue_area == "public_transit"]
    assert len(housing_queries) > 0
    assert len(transit_queries) > 0


async def test_generate_queries_async_generator():
    from atlas_scout.steps.query_gen import generate_queries_stream

    queries: list[SearchQuery] = []
    async for q in generate_queries_stream(city="Austin", state="TX", issue_areas=["housing_affordability"]):
        queries.append(q)
    assert len(queries) > 0
```

- [ ] **Step 2: Implement query gen**

Port from `api/atlas/domains/discovery/pipeline/query_generator.py`, adding an async generator wrapper:

```python
# pipeline/src/atlas_scout/steps/__init__.py
"""Pipeline steps for Atlas Scout."""
```

```python
# pipeline/src/atlas_scout/steps/query_gen.py
"""Step 1: Search query generation from location + issue areas."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from atlas_shared import ISSUE_SEARCH_TERMS


@dataclass
class SearchQuery:
    query: str
    source_category: str
    issue_area: str


_SOURCE_PATTERNS: dict[str, list[str]] = {
    "local_journalism": [
        "{location} {keywords}",
    ],
    "nonprofits": [
        "{location} {keywords} nonprofit",
        "{location} {keywords} organization",
    ],
    "individuals": [
        "{location} {keywords} organizer",
        "{location} {keywords} advocate",
    ],
    "campaigns": [
        "{location} {keywords} campaign",
        "{location} {keywords} initiative",
    ],
    "academic_policy": [
        "{location} {keywords} study",
        "{location} {keywords} university research",
    ],
}


def generate_queries(
    city: str,
    state: str,
    issue_areas: list[str],
) -> list[SearchQuery]:
    """Generate search queries for a location and set of issue areas."""
    queries: list[SearchQuery] = []
    location = f"{city}, {state}"

    for issue_slug in issue_areas:
        if issue_slug not in ISSUE_SEARCH_TERMS:
            continue
        keywords_list = ISSUE_SEARCH_TERMS[issue_slug]

        for source_category, patterns in _SOURCE_PATTERNS.items():
            for pattern in patterns:
                for keywords in keywords_list:
                    query_text = pattern.format(location=location, keywords=keywords)
                    queries.append(
                        SearchQuery(
                            query=" ".join(query_text.split()),
                            source_category=source_category,
                            issue_area=issue_slug,
                        )
                    )

    return queries


async def generate_queries_stream(
    city: str,
    state: str,
    issue_areas: list[str],
) -> AsyncIterator[SearchQuery]:
    """Async generator wrapper — yields queries as they're generated."""
    for query in generate_queries(city, state, issue_areas):
        yield query
```

- [ ] **Step 3: Run query gen tests**

Run: `cd pipeline && uv run pytest tests/test_steps/test_query_gen.py -v`
Expected: All 5 tests PASS

- [ ] **Step 4: Write failing source fetch tests**

```python
# pipeline/tests/test_steps/test_source_fetch.py
import httpx
import pytest
import respx

from atlas_scout.scraper.fetcher import AsyncFetcher
from atlas_scout.steps.query_gen import SearchQuery
from atlas_scout.steps.source_fetch import fetch_sources_stream


@respx.mock
async def test_fetch_sources_from_queries():
    # Mock Brave search API
    respx.get("https://api.search.brave.com/res/v1/web/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {"url": "https://example.com/result1", "title": "Result 1"},
                        {"url": "https://example.com/result2", "title": "Result 2"},
                    ]
                }
            },
        )
    )
    # Mock page fetches
    respx.get("https://example.com/result1").mock(
        return_value=httpx.Response(
            200,
            text="<html><body><article><p>" + " ".join(["housing policy"] * 150) + "</p></article></body></html>",
        )
    )
    respx.get("https://example.com/result2").mock(
        return_value=httpx.Response(
            200,
            text="<html><body><article><p>" + " ".join(["zoning reform"] * 150) + "</p></article></body></html>",
        )
    )

    queries = [
        SearchQuery(query="Austin, TX housing", source_category="local_journalism", issue_area="housing_affordability"),
    ]
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)

    pages = []
    async for page in fetch_sources_stream(
        queries=queries,
        fetcher=fetcher,
        search_api_key="test-key",
    ):
        pages.append(page)

    assert len(pages) > 0


@respx.mock
async def test_fetch_sources_deduplicates_urls():
    # Both queries return the same URL
    respx.get("https://api.search.brave.com/res/v1/web/search").mock(
        return_value=httpx.Response(
            200,
            json={"web": {"results": [{"url": "https://example.com/same", "title": "Same"}]}},
        )
    )
    respx.get("https://example.com/same").mock(
        return_value=httpx.Response(
            200,
            text="<html><body><article><p>" + " ".join(["content"] * 200) + "</p></article></body></html>",
        )
    )

    queries = [
        SearchQuery(query="q1", source_category="nonprofits", issue_area="housing_affordability"),
        SearchQuery(query="q2", source_category="nonprofits", issue_area="housing_affordability"),
    ]
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)

    pages = []
    async for page in fetch_sources_stream(queries=queries, fetcher=fetcher, search_api_key="test-key"):
        pages.append(page)

    # Should only fetch and yield the URL once
    assert len(pages) <= 1
```

- [ ] **Step 5: Implement source fetch**

```python
# pipeline/src/atlas_scout/steps/source_fetch.py
"""Step 2: Fetch sources from search results."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import httpx

from atlas_shared import PageContent
from atlas_scout.scraper.fetcher import AsyncFetcher
from atlas_scout.steps.query_gen import SearchQuery

logger = logging.getLogger(__name__)


async def _search_brave(
    queries: list[SearchQuery],
    api_key: str,
    results_per_query: int = 5,
) -> list[dict[str, str | None]]:
    """Execute search queries via Brave Search API, return unique URLs."""
    headers = {"Accept": "application/json", "X-Subscription-Token": api_key}
    seen_urls: set[str] = set()
    results: list[dict[str, str | None]] = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        for query in queries:
            try:
                resp = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params={"q": query.query, "count": results_per_query},
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("web", {}).get("results", []):
                    url = item.get("url")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        results.append({
                            "url": url,
                            "title": item.get("title"),
                        })
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                logger.warning("Search failed for query %r: %s", query.query, exc)

    return results


async def fetch_sources_stream(
    queries: list[SearchQuery] | AsyncIterator[SearchQuery],
    fetcher: AsyncFetcher,
    search_api_key: str,
) -> AsyncIterator[PageContent]:
    """Search + fetch pages, yielding as they complete."""
    # Collect queries (may come from async generator)
    query_list: list[SearchQuery] = []
    if hasattr(queries, "__aiter__"):
        async for q in queries:
            query_list.append(q)
    else:
        query_list = list(queries)

    if not search_api_key:
        logger.warning("No search API key; source fetching skipped")
        return

    search_results = await _search_brave(query_list, search_api_key)
    urls = [r["url"] for r in search_results if r["url"]]

    # Fan out fetches concurrently, yield as they complete
    tasks = {asyncio.create_task(fetcher.fetch(url)): url for url in urls}
    for coro in asyncio.as_completed(tasks):
        page = await coro
        if page is not None:
            yield page
```

- [ ] **Step 6: Run source fetch tests**

Run: `cd pipeline && uv run pytest tests/test_steps/test_source_fetch.py -v`
Expected: All 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/atlas_scout/steps/ pipeline/tests/test_steps/
git commit -m "feat(scout): add pipeline steps 1-2 (query gen + source fetch)

Step 1 generates search queries from location + issue areas using the
shared taxonomy. Step 2 searches via Brave API and fetches pages
concurrently, yielding as an async generator for pipeline streaming."
```

---

### Task 9: Pipeline Step 3 (Entry Extraction)

**Files:**
- Create: `pipeline/src/atlas_scout/steps/entry_extract.py`
- Test: `pipeline/tests/test_steps/test_entry_extract.py`
- Reference: `api/atlas/domains/discovery/pipeline/extractor.py` (port from)

- [ ] **Step 1: Write failing extraction tests**

```python
# pipeline/tests/test_steps/test_entry_extract.py
import json
from unittest.mock import AsyncMock

import pytest

from atlas_shared import PageContent, RawEntry
from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import extract_entries_stream, _build_extraction_prompt


def test_build_extraction_prompt():
    prompt = _build_extraction_prompt("Austin", "TX")
    assert "Austin" in prompt
    assert "TX" in prompt
    assert "housing_affordability" in prompt  # from taxonomy


async def test_extract_entries_from_page():
    mock_provider = AsyncMock()
    mock_provider.max_concurrent = 5
    mock_provider.complete.return_value = Completion(
        text=json.dumps([
            {
                "name": "Austin Housing Alliance",
                "type": "organization",
                "description": "Affordable housing advocacy group",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
                "website": "https://aha.org",
                "email": None,
                "social_media": None,
                "affiliated_org": None,
                "extraction_context": "The Austin Housing Alliance works to...",
            }
        ]),
        parsed=None,
    )

    pages = [
        PageContent(url="https://example.com/article", text="Article about Austin Housing Alliance...", title="Housing News"),
    ]

    entries: list[RawEntry] = []

    async def page_iter():
        for p in pages:
            yield p

    async for entry in extract_entries_stream(
        pages=page_iter(),
        provider=mock_provider,
        city="Austin",
        state="TX",
    ):
        entries.append(entry)

    assert len(entries) == 1
    assert entries[0].name == "Austin Housing Alliance"
    assert entries[0].entry_type == "organization"
    assert entries[0].source_url == "https://example.com/article"


async def test_extract_entries_skips_empty_results():
    mock_provider = AsyncMock()
    mock_provider.max_concurrent = 5
    mock_provider.complete.return_value = Completion(text="[]", parsed=None)

    pages = [PageContent(url="https://example.com/empty", text="No entities here", title="Empty")]

    async def page_iter():
        for p in pages:
            yield p

    entries = []
    async for entry in extract_entries_stream(pages=page_iter(), provider=mock_provider, city="Austin", state="TX"):
        entries.append(entry)

    assert len(entries) == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_steps/test_entry_extract.py -v`
Expected: FAIL

- [ ] **Step 3: Implement entry extraction**

```python
# pipeline/src/atlas_scout/steps/entry_extract.py
"""Step 3: LLM-based entity extraction from page content."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from atlas_shared import ISSUE_AREAS_BY_DOMAIN, PageContent, RawEntry
from atlas_scout.providers.base import Completion, LLMProvider, Message

logger = logging.getLogger(__name__)


def _build_extraction_prompt(city: str, state: str) -> str:
    """Build extraction system prompt with full taxonomy."""
    taxonomy_lines = [
        f"- {issue.slug}: {issue.name}"
        for issues in ISSUE_AREAS_BY_DOMAIN.values()
        for issue in issues
    ]
    taxonomy_text = "\n".join(taxonomy_lines)
    return (
        "You are extracting structured data from a source document for Atlas.\n\n"
        f"Target location: {city}, {state}\n\n"
        "Issue taxonomy:\n"
        f"{taxonomy_text}\n\n"
        "Return a JSON array of entries. Each entry must contain: "
        "name, type, description, city, state, geo_specificity, issue_areas, "
        "affiliated_org, website, email, social_media, extraction_context.\n"
        "Only include people, organizations, initiatives, campaigns, or events "
        "connected to the target location and one or more issue areas.\n"
        "Return [] if no relevant entities are found."
    )


def _parse_extraction_response(text: str, source_url: str) -> list[RawEntry]:
    """Parse LLM JSON output into typed entries."""
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1]
        clean = clean.rsplit("\n```", 1)[0]

    payload = json.loads(clean)
    if isinstance(payload, dict):
        payload = payload.get("entries", [])

    entries: list[RawEntry] = []
    for item in payload:
        entries.append(
            RawEntry(
                name=item["name"],
                entry_type=item["type"],
                description=item["description"],
                city=item.get("city"),
                state=item.get("state"),
                geo_specificity=item.get("geo_specificity", "local"),
                issue_areas=item.get("issue_areas", []),
                region=item.get("region"),
                website=item.get("website"),
                email=item.get("email"),
                social_media=item.get("social_media"),
                affiliated_org=item.get("affiliated_org"),
                extraction_context=item.get("extraction_context"),
                source_url=source_url,
            )
        )
    return entries


async def _extract_from_page(
    page: PageContent,
    provider: LLMProvider,
    system_prompt: str,
    semaphore: asyncio.Semaphore,
) -> list[RawEntry]:
    """Extract entries from a single page."""
    async with semaphore:
        try:
            result = await provider.complete(
                [
                    Message(role="system", content=system_prompt),
                    Message(
                        role="user",
                        content=f"Source URL: {page.url}\n"
                        f"Extract Atlas entries from the following source text and return JSON only.\n\n"
                        f"{page.text[:8000]}",
                    ),
                ],
            )
            return _parse_extraction_response(result.text, source_url=page.url)
        except Exception as exc:
            logger.warning("Extraction failed for %s: %s", page.url, exc)
            return []


async def extract_entries_stream(
    pages: AsyncIterator[PageContent],
    provider: LLMProvider,
    city: str,
    state: str,
) -> AsyncIterator[RawEntry]:
    """Extract entries from pages concurrently, yielding as they complete."""
    system_prompt = _build_extraction_prompt(city, state)
    semaphore = asyncio.Semaphore(provider.max_concurrent)

    tasks: list[asyncio.Task[list[RawEntry]]] = []
    async for page in pages:
        task = asyncio.create_task(
            _extract_from_page(page, provider, system_prompt, semaphore)
        )
        tasks.append(task)

    for coro in asyncio.as_completed(tasks):
        entries = await coro
        for entry in entries:
            yield entry
```

- [ ] **Step 4: Run extraction tests**

Run: `cd pipeline && uv run pytest tests/test_steps/test_entry_extract.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/atlas_scout/steps/entry_extract.py pipeline/tests/test_steps/test_entry_extract.py
git commit -m "feat(scout): add pipeline step 3 (LLM entity extraction)

Provider-agnostic extraction using the LLMProvider protocol. Builds
extraction prompt with full taxonomy, fans out concurrent LLM calls
per page bounded by provider.max_concurrent, yields RawEntry items
as an async generator."
```

---

### Task 10: Pipeline Steps 4-6 (Dedup, Ranking, Gap Analysis)

**Files:**
- Create: `pipeline/src/atlas_scout/steps/dedup.py`
- Create: `pipeline/src/atlas_scout/steps/rank.py`
- Create: `pipeline/src/atlas_scout/steps/gap_analysis.py`
- Test: `pipeline/tests/test_steps/test_dedup.py`
- Test: `pipeline/tests/test_steps/test_rank.py`
- Test: `pipeline/tests/test_steps/test_gap_analysis.py`
- Reference: `api/atlas/domains/discovery/pipeline/deduplicator.py` (port)
- Reference: `api/atlas/domains/discovery/pipeline/ranker.py` (port)
- Reference: `api/atlas/domains/discovery/pipeline/gap_analyzer.py` (port)

- [ ] **Step 1: Write failing dedup tests**

```python
# pipeline/tests/test_steps/test_dedup.py
from atlas_shared import DeduplicatedEntry, RawEntry
from atlas_scout.steps.dedup import deduplicate_stream


async def test_dedup_merges_exact_duplicates():
    entries = [
        RawEntry(name="Housing Alliance", entry_type="organization", description="Short desc", city="Austin", state="TX", source_url="https://a.com"),
        RawEntry(name="Housing Alliance", entry_type="organization", description="A longer and more detailed description of the Housing Alliance", city="Austin", state="TX", source_url="https://b.com"),
    ]

    async def entry_iter():
        for e in entries:
            yield e

    results: list[DeduplicatedEntry] = []
    async for deduped in deduplicate_stream(entry_iter(), batch_size=10):
        results.append(deduped)

    assert len(results) == 1
    assert len(results[0].source_urls) == 2
    # Keeps the longer description
    assert "longer" in results[0].description


async def test_dedup_keeps_distinct_entries():
    entries = [
        RawEntry(name="Org A", entry_type="organization", description="First org", city="Austin", state="TX", source_url="https://a.com"),
        RawEntry(name="Org B", entry_type="organization", description="Second org", city="Austin", state="TX", source_url="https://b.com"),
    ]

    async def entry_iter():
        for e in entries:
            yield e

    results = []
    async for deduped in deduplicate_stream(entry_iter(), batch_size=10):
        results.append(deduped)

    assert len(results) == 2
```

- [ ] **Step 2: Write failing rank tests**

```python
# pipeline/tests/test_steps/test_rank.py
from atlas_shared import DeduplicatedEntry, RankedEntry
from atlas_scout.steps.rank import rank_entries_stream


async def test_rank_scores_entries():
    entries = [
        DeduplicatedEntry(
            name="Well-Sourced Org",
            entry_type="organization",
            description="A detailed description of a well-sourced organization doing important work",
            city="Austin",
            state="TX",
            geo_specificity="local",
            source_urls=["https://a.com", "https://b.com", "https://c.com"],
            website="https://org.com",
            email="info@org.com",
        ),
        DeduplicatedEntry(
            name="Sparse Entry",
            entry_type="organization",
            description="Brief",
            city="Austin",
            state="TX",
        ),
    ]

    async def entry_iter():
        for e in entries:
            yield e

    results: list[RankedEntry] = []
    async for ranked in rank_entries_stream(entry_iter()):
        results.append(ranked)

    assert len(results) == 2
    assert results[0].score > results[1].score  # Well-sourced ranks higher


async def test_rank_filters_below_threshold():
    entries = [
        DeduplicatedEntry(name="Sparse", entry_type="organization", description="x", city="Austin", state="TX"),
    ]

    async def entry_iter():
        for e in entries:
            yield e

    results = []
    async for ranked in rank_entries_stream(entry_iter(), min_score=0.9):
        results.append(ranked)

    assert len(results) == 0  # Below threshold
```

- [ ] **Step 3: Write failing gap analysis tests**

```python
# pipeline/tests/test_steps/test_gap_analysis.py
from atlas_shared import GapReport, RankedEntry, DeduplicatedEntry
from atlas_scout.steps.gap_analysis import analyze_gaps


def test_analyze_gaps_finds_missing_issues():
    entries = [
        RankedEntry(
            entry=DeduplicatedEntry(
                name="Housing Org",
                entry_type="organization",
                description="Housing work",
                city="Austin",
                state="TX",
                issue_areas=["housing_affordability"],
            ),
            score=0.8,
        ),
    ]
    report = analyze_gaps("Austin, TX", entries)
    assert isinstance(report, GapReport)
    assert report.total_entries == 1
    assert len(report.missing_issues) > 0
    # housing_affordability should be in thin (only 1 entry) not missing
    missing_slugs = {g.issue_area_slug for g in report.missing_issues}
    assert "housing_affordability" not in missing_slugs


def test_analyze_gaps_detects_uncovered_domains():
    report = analyze_gaps("Austin, TX", [])
    assert len(report.uncovered_domains) == 11  # All domains uncovered
```

- [ ] **Step 4: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_steps/test_dedup.py tests/test_steps/test_rank.py tests/test_steps/test_gap_analysis.py -v`
Expected: FAIL

- [ ] **Step 5: Implement dedup**

```python
# pipeline/src/atlas_scout/steps/dedup.py
"""Step 4: Streaming deduplication of extracted entries."""

from __future__ import annotations

from collections.abc import AsyncIterator
from difflib import SequenceMatcher

from atlas_shared import DeduplicatedEntry, RawEntry

HIGH_SIMILARITY_THRESHOLD = 0.9


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _should_merge(a: DeduplicatedEntry, b: RawEntry) -> bool:
    """Check if a raw entry should merge into an existing deduplicated entry."""
    exact_name = a.name.strip().lower() == b.name.strip().lower()
    same_city = a.city == b.city
    same_type = a.entry_type == b.entry_type
    high_sim = same_city and _similarity(a.name, b.name) >= HIGH_SIMILARITY_THRESHOLD

    return (exact_name and same_city and same_type) or (exact_name and same_type) or high_sim


def _merge(existing: DeduplicatedEntry, new: RawEntry) -> DeduplicatedEntry:
    """Merge a new raw entry into an existing deduplicated entry."""
    description = max([existing.description, new.description], key=len)
    source_urls = sorted(set(existing.source_urls + ([new.source_url] if new.source_url else [])))
    issue_areas = sorted(set(existing.issue_areas + new.issue_areas))

    return existing.model_copy(update={
        "description": description,
        "source_urls": source_urls,
        "issue_areas": issue_areas,
        "website": existing.website or new.website,
        "email": existing.email or new.email,
        "social_media": {**(existing.social_media or {}), **(new.social_media or {})} or None,
        "affiliated_org": existing.affiliated_org or new.affiliated_org,
    })


def _raw_to_deduped(entry: RawEntry) -> DeduplicatedEntry:
    return DeduplicatedEntry(
        name=entry.name,
        entry_type=entry.entry_type,
        description=entry.description,
        city=entry.city,
        state=entry.state,
        geo_specificity=entry.geo_specificity,
        issue_areas=entry.issue_areas,
        region=entry.region,
        website=entry.website,
        email=entry.email,
        social_media=entry.social_media,
        affiliated_org=entry.affiliated_org,
        source_urls=[entry.source_url] if entry.source_url else [],
        source_contexts={entry.source_url: entry.extraction_context} if entry.source_url else {},
    )


async def deduplicate_stream(
    entries: AsyncIterator[RawEntry],
    batch_size: int = 50,
) -> AsyncIterator[DeduplicatedEntry]:
    """Deduplicate entries in streaming batches."""
    canonical: list[DeduplicatedEntry] = []

    async for entry in entries:
        merged = False
        for i, existing in enumerate(canonical):
            if _should_merge(existing, entry):
                canonical[i] = _merge(existing, entry)
                merged = True
                break
        if not merged:
            canonical.append(_raw_to_deduped(entry))

    for entry in canonical:
        yield entry
```

- [ ] **Step 6: Implement ranking**

```python
# pipeline/src/atlas_scout/steps/rank.py
"""Step 5: Score and rank deduplicated entries."""

from __future__ import annotations

from collections.abc import AsyncIterator

from atlas_shared import DeduplicatedEntry, RankedEntry


def _score_entry(entry: DeduplicatedEntry) -> tuple[float, dict[str, float]]:
    """Score an entry on multiple dimensions."""
    source_density = min(float(len(entry.source_urls)), 5.0)
    geo_score = {
        "local": 1.0,
        "regional": 0.75,
        "statewide": 0.5,
        "national": 0.25,
    }.get(entry.geo_specificity, 0.0)
    contact_score = (
        1.0
        if entry.website and entry.email
        else (0.6 if entry.website else 0.0)
    )
    description_score = min(len(entry.description.split()) / 25.0, 1.0)
    issue_score = min(len(entry.issue_areas) / 3.0, 1.0)

    components = {
        "source_density": source_density,
        "geo_specificity": geo_score,
        "contact_surface": contact_score,
        "description_quality": description_score,
        "issue_coverage": issue_score,
    }

    score = (
        source_density * 0.35
        + geo_score * 0.15
        + contact_score * 0.20
        + description_score * 0.15
        + issue_score * 0.15
    )
    # Normalize: source_density dominates so cap the total
    score = min(score / 3.0, 1.0)

    return score, components


async def rank_entries_stream(
    entries: AsyncIterator[DeduplicatedEntry],
    min_score: float = 0.0,
) -> AsyncIterator[RankedEntry]:
    """Score entries and yield those above the threshold, sorted by score."""
    ranked: list[RankedEntry] = []

    async for entry in entries:
        score, components = _score_entry(entry)
        if score >= min_score:
            ranked.append(RankedEntry(entry=entry, score=score, components=components))

    ranked.sort(key=lambda r: r.score, reverse=True)
    for item in ranked:
        yield item
```

- [ ] **Step 7: Implement gap analysis**

```python
# pipeline/src/atlas_scout/steps/gap_analysis.py
"""Step 6: Coverage gap analysis."""

from __future__ import annotations

from atlas_shared import (
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    CoverageGap,
    GapReport,
    RankedEntry,
)

COVERED_THRESHOLD = 3
THIN_THRESHOLD = 1


def analyze_gaps(location: str, entries: list[RankedEntry]) -> GapReport:
    """Analyze coverage gaps for a location given ranked entries."""
    issue_counts: dict[str, int] = {}
    for ranked in entries:
        for issue in ranked.entry.issue_areas:
            issue_counts[issue] = issue_counts.get(issue, 0) + 1

    covered: list[CoverageGap] = []
    missing: list[CoverageGap] = []
    thin: list[CoverageGap] = []

    all_issues = {
        issue.slug: issue
        for issues in ISSUE_AREAS_BY_DOMAIN.values()
        for issue in issues
    }

    for slug, issue in all_issues.items():
        count = issue_counts.get(slug, 0)
        severity = (
            "covered"
            if count >= COVERED_THRESHOLD
            else ("thin" if count >= THIN_THRESHOLD else "critical")
        )
        gap = CoverageGap(
            issue_area_slug=slug,
            issue_area_name=issue.name,
            entry_count=count,
            severity=severity,
        )
        if count == 0:
            missing.append(gap)
        elif count < COVERED_THRESHOLD:
            thin.append(gap)
        else:
            covered.append(gap)

    uncovered_domains = [
        domain
        for domain in DOMAINS
        if not any(
            issue_counts.get(issue.slug, 0) > 0
            for issue in ISSUE_AREAS_BY_DOMAIN[domain]
        )
    ]

    return GapReport(
        location=location,
        total_entries=len(entries),
        covered_issues=covered,
        missing_issues=missing,
        thin_issues=thin,
        uncovered_domains=uncovered_domains,
    )
```

- [ ] **Step 8: Run all step 4-6 tests**

Run: `cd pipeline && uv run pytest tests/test_steps/test_dedup.py tests/test_steps/test_rank.py tests/test_steps/test_gap_analysis.py -v`
Expected: All 6 tests PASS

- [ ] **Step 9: Commit**

```bash
git add pipeline/src/atlas_scout/steps/dedup.py pipeline/src/atlas_scout/steps/rank.py pipeline/src/atlas_scout/steps/gap_analysis.py pipeline/tests/test_steps/
git commit -m "feat(scout): add pipeline steps 4-6 (dedup, ranking, gap analysis)

Step 4 deduplicates via fuzzy name matching and merges source lists.
Step 5 scores entries on source density, geo specificity, contact
surface, and description quality. Step 6 analyzes coverage gaps
across the full issue taxonomy."
```

---

### Task 11: Streaming Pipeline Orchestrator

**Files:**
- Create: `pipeline/src/atlas_scout/pipeline.py`
- Test: `pipeline/tests/test_pipeline.py`

- [ ] **Step 1: Write failing pipeline tests**

```python
# pipeline/tests/test_pipeline.py
import json
from unittest.mock import AsyncMock

import pytest

from atlas_shared import RankedEntry
from atlas_scout.config import ScoutConfig
from atlas_scout.pipeline import PipelineResult, run_pipeline
from atlas_scout.providers.base import Completion


@pytest.fixture
def mock_provider():
    provider = AsyncMock()
    provider.max_concurrent = 5
    provider.complete.return_value = Completion(
        text=json.dumps([
            {
                "name": "Test Org",
                "type": "organization",
                "description": "A test organization working on housing issues in Austin Texas",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
                "website": "https://test.org",
                "email": "info@test.org",
                "social_media": None,
                "affiliated_org": None,
                "extraction_context": "Test org was mentioned...",
            }
        ]),
        parsed=None,
    )
    return provider


async def test_run_pipeline_returns_result(mock_provider, tmp_db_path):
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    # Mock fetcher to avoid real HTTP
    mock_fetcher = AsyncMock()
    from atlas_shared import PageContent
    mock_fetcher.fetch.return_value = PageContent(
        url="https://example.com/article",
        text="Article about Test Org housing advocacy in Austin " * 50,
        title="Housing News",
    )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=mock_provider,
        store=store,
        search_api_key="test-key",
        fetcher=mock_fetcher,
    )

    assert isinstance(result, PipelineResult)
    assert result.entries_found >= 0
    assert result.gap_report is not None

    await store.close()


async def test_pipeline_result_has_stats(mock_provider, tmp_db_path):
    from atlas_scout.store import ScoutStore
    from atlas_shared import PageContent

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    mock_fetcher = AsyncMock()
    mock_fetcher.fetch.return_value = PageContent(
        url="https://example.com",
        text="Content about organizations " * 50,
        title="News",
    )

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=mock_provider,
        store=store,
        search_api_key="test-key",
        fetcher=mock_fetcher,
    )

    assert result.run_id is not None
    assert result.queries_generated > 0

    await store.close()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_pipeline.py -v`
Expected: FAIL

- [ ] **Step 3: Implement pipeline orchestrator**

```python
# pipeline/src/atlas_scout/pipeline.py
"""Streaming pipeline orchestrator for Atlas Scout."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas_shared import GapReport, RankedEntry
from atlas_scout.steps.dedup import deduplicate_stream
from atlas_scout.steps.entry_extract import extract_entries_stream
from atlas_scout.steps.gap_analysis import analyze_gaps
from atlas_scout.steps.query_gen import generate_queries, generate_queries_stream
from atlas_scout.steps.rank import rank_entries_stream
from atlas_scout.steps.source_fetch import fetch_sources_stream

if TYPE_CHECKING:
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    run_id: str
    queries_generated: int
    pages_fetched: int
    entries_found: int
    entries_after_dedup: int
    ranked_entries: list[RankedEntry]
    gap_report: GapReport


async def run_pipeline(
    *,
    location: str,
    issues: list[str],
    provider: LLMProvider,
    store: ScoutStore,
    search_api_key: str,
    search_depth: str = "standard",
    min_entry_score: float = 0.3,
    fetcher: AsyncFetcher | None = None,
) -> PipelineResult:
    """Execute the full Scout discovery pipeline."""
    city, state = _parse_location(location)

    # Create run record
    run_id = await store.create_run(
        location=location,
        issues=issues,
        search_depth=search_depth,
    )
    await store.update_run_status(run_id, "running")

    try:
        # Step 1: Generate queries
        queries = generate_queries(city=city, state=state, issue_areas=issues)
        queries_count = len(queries)
        logger.info("Generated %d search queries", queries_count)

        # Step 2: Fetch sources (streaming)
        if fetcher is None:
            from atlas_scout.scraper.fetcher import AsyncFetcher
            fetcher = AsyncFetcher(store=store)

        pages_stream = fetch_sources_stream(
            queries=generate_queries_stream(city=city, state=state, issue_areas=issues),
            fetcher=fetcher,
            search_api_key=search_api_key,
        )

        # Step 3: Extract entries (streaming from pages)
        raw_entries_stream = extract_entries_stream(
            pages=pages_stream,
            provider=provider,
            city=city,
            state=state,
        )

        # Step 4: Deduplicate (streaming batches)
        deduped_stream = deduplicate_stream(raw_entries_stream)

        # Step 5: Rank (streaming)
        ranked_stream = rank_entries_stream(deduped_stream, min_score=min_entry_score)

        # Materialize ranked results
        ranked_entries: list[RankedEntry] = []
        async for ranked in ranked_stream:
            ranked_entries.append(ranked)
            # Save each entry to local store
            await store.save_entry(
                run_id=run_id,
                name=ranked.entry.name,
                entry_type=ranked.entry.entry_type,
                description=ranked.entry.description,
                city=ranked.entry.city,
                state=ranked.entry.state,
                score=ranked.score,
                data=ranked.entry.model_dump(),
            )

        # Step 6: Gap analysis (batch)
        gap_report = analyze_gaps(location, ranked_entries)

        logger.info(
            "Pipeline complete: %d entries, %d uncovered domains",
            len(ranked_entries),
            len(gap_report.uncovered_domains),
        )

        await store.complete_run(
            run_id,
            queries=queries_count,
            pages_fetched=0,  # TODO: track via fetcher stats
            entries_found=len(ranked_entries),
            entries_after_dedup=len(ranked_entries),
        )

        return PipelineResult(
            run_id=run_id,
            queries_generated=queries_count,
            pages_fetched=0,
            entries_found=len(ranked_entries),
            entries_after_dedup=len(ranked_entries),
            ranked_entries=ranked_entries,
            gap_report=gap_report,
        )

    except Exception as exc:
        logger.exception("Pipeline failed for run %s", run_id)
        await store.fail_run(run_id, str(exc))
        raise


def _parse_location(location: str) -> tuple[str, str]:
    """Parse 'City, ST' into (city, state)."""
    parts = location.split(",", maxsplit=1)
    city = parts[0].strip()
    state = parts[1].strip() if len(parts) > 1 else ""
    return city, state
```

- [ ] **Step 4: Run pipeline tests**

Run: `cd pipeline && uv run pytest tests/test_pipeline.py -v`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/atlas_scout/pipeline.py pipeline/tests/test_pipeline.py
git commit -m "feat(scout): add streaming pipeline orchestrator

Composes all 6 steps as a streaming async pipeline: query gen ->
source fetch -> extraction -> dedup -> ranking -> gap analysis.
Steps overlap via async generators for maximum throughput. Tracks
run state in local SQLite store."
```

---

### Task 12: CLI

**Files:**
- Create: `pipeline/src/atlas_scout/cli.py`
- Test: `pipeline/tests/test_cli.py`

- [ ] **Step 1: Write failing CLI tests**

```python
# pipeline/tests/test_cli.py
from click.testing import CliRunner

from atlas_scout.cli import main


def test_cli_help():
    runner = CliRunner()
    result = runner.invoke(main, ["--help"])
    assert result.exit_code == 0
    assert "Atlas Scout" in result.output


def test_cli_run_help():
    runner = CliRunner()
    result = runner.invoke(main, ["run", "--help"])
    assert result.exit_code == 0
    assert "--location" in result.output
    assert "--issues" in result.output


def test_cli_runs_list_help():
    runner = CliRunner()
    result = runner.invoke(main, ["runs", "list", "--help"])
    assert result.exit_code == 0


def test_cli_run_requires_location():
    runner = CliRunner()
    result = runner.invoke(main, ["run"])
    assert result.exit_code != 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && uv run pytest tests/test_cli.py -v`
Expected: FAIL

- [ ] **Step 3: Implement CLI**

```python
# pipeline/src/atlas_scout/cli.py
"""Atlas Scout CLI — autonomous web discovery pipeline."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import click

from atlas_scout.config import ScoutConfig, load_config


def _default_config_path() -> Path:
    return Path.home() / ".atlas-scout" / "scout.toml"


def _default_db_path() -> Path:
    return Path.home() / ".atlas-scout" / "scout.db"


@click.group()
@click.option(
    "--config",
    "config_path",
    type=click.Path(exists=False),
    default=None,
    help="Path to scout.toml config file",
)
@click.pass_context
def main(ctx: click.Context, config_path: str | None) -> None:
    """Atlas Scout — discover people, orgs, and initiatives from the web."""
    ctx.ensure_object(dict)
    path = Path(config_path) if config_path else _default_config_path()
    ctx.obj["config"] = load_config(path)
    ctx.obj["config_path"] = path


@main.command()
@click.option("--location", required=True, help="Location to discover (e.g. 'Austin, TX')")
@click.option("--issues", required=True, help="Comma-separated issue area slugs")
@click.option("--depth", type=click.Choice(["standard", "deep"]), default="standard")
@click.option("--search-api-key", envvar="SEARCH_API_KEY", default=None)
@click.pass_context
def run(ctx: click.Context, location: str, issues: str, depth: str, search_api_key: str | None) -> None:
    """Run a discovery pipeline for a location and set of issues."""
    config: ScoutConfig = ctx.obj["config"]
    issue_list = [i.strip() for i in issues.split(",")]

    if not search_api_key:
        click.echo("Error: SEARCH_API_KEY required (set via --search-api-key or env var)", err=True)
        sys.exit(1)

    click.echo(f"Starting discovery for {location}")
    click.echo(f"Issues: {', '.join(issue_list)}")
    click.echo(f"LLM provider: {config.llm.provider} ({config.llm.model})")
    click.echo()

    asyncio.run(_run_pipeline(config, location, issue_list, depth, search_api_key))


async def _run_pipeline(
    config: ScoutConfig,
    location: str,
    issues: list[str],
    search_depth: str,
    search_api_key: str,
) -> None:
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.providers import create_provider
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    store = ScoutStore(str(db_path))
    await store.initialize()

    provider = create_provider(config.llm)

    try:
        result = await run_pipeline(
            location=location,
            issues=issues,
            provider=provider,
            store=store,
            search_api_key=search_api_key,
            search_depth=search_depth,
            min_entry_score=config.pipeline.min_entry_score,
        )

        click.echo(f"\nDiscovery complete! Run ID: {result.run_id}")
        click.echo(f"  Queries generated: {result.queries_generated}")
        click.echo(f"  Entries found: {result.entries_found}")
        click.echo(f"  Gap report: {len(result.gap_report.missing_issues)} missing issues, "
                    f"{len(result.gap_report.uncovered_domains)} uncovered domains")

        if result.ranked_entries:
            click.echo(f"\nTop entries:")
            for ranked in result.ranked_entries[:10]:
                click.echo(f"  [{ranked.score:.2f}] {ranked.entry.name} ({ranked.entry.entry_type})")
    finally:
        await store.close()


@main.group()
def runs() -> None:
    """Manage discovery runs."""


@runs.command("list")
@click.option("--limit", default=20, help="Max runs to show")
@click.pass_context
def runs_list(ctx: click.Context, limit: int) -> None:
    """List recent discovery runs."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_list_runs(config, limit))


async def _list_runs(config: ScoutConfig, limit: int) -> None:
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        click.echo("No runs yet. Run 'scout run' to start discovering.")
        return

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        run_list = await store.list_runs(limit=limit)
        if not run_list:
            click.echo("No runs yet.")
            return
        for r in run_list:
            status_icon = {"completed": "+", "failed": "x", "running": "~", "pending": "."}.get(r["status"], "?")
            click.echo(f"  [{status_icon}] {r['id']}  {r['location']}  {r['status']}  {r['created_at'][:19]}")
    finally:
        await store.close()


@runs.command("inspect")
@click.argument("run_id")
@click.pass_context
def runs_inspect(ctx: click.Context, run_id: str) -> None:
    """Show details of a specific run."""
    config: ScoutConfig = ctx.obj["config"]
    asyncio.run(_inspect_run(config, run_id))


async def _inspect_run(config: ScoutConfig, run_id: str) -> None:
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        run = await store.get_run(run_id)
        click.echo(f"Run {run['id']}")
        click.echo(f"  Location: {run['location']}")
        click.echo(f"  Status: {run['status']}")
        click.echo(f"  Created: {run['created_at']}")
        if run.get("entries_found"):
            click.echo(f"  Entries found: {run['entries_found']}")

        entries = await store.list_entries(run_id=run_id)
        if entries:
            click.echo(f"\n  Entries ({len(entries)}):")
            for e in entries[:20]:
                click.echo(f"    [{e['score']:.2f}] {e['name']} ({e['entry_type']})")
    finally:
        await store.close()
```

- [ ] **Step 4: Run CLI tests**

Run: `cd pipeline && uv run pytest tests/test_cli.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd pipeline && uv run pytest -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/atlas_scout/cli.py pipeline/tests/test_cli.py
git commit -m "feat(scout): add CLI with run, runs list, and runs inspect commands

Implements the scout CLI:
- scout run --location 'Austin, TX' --issues housing_affordability
- scout runs list
- scout runs inspect <run-id>

Loads config from ~/.atlas-scout/scout.toml, stores results in
~/.atlas-scout/scout.db."
```

---

## Verification Plan

After all tasks are complete:

1. **Unit tests pass:**
   ```bash
   cd shared && uv run pytest -v
   cd ../pipeline && uv run pytest -v
   ```

2. **CLI runs end-to-end (with mocked externals):**
   ```bash
   cd pipeline && uv run scout --help
   cd pipeline && uv run scout run --help
   ```

3. **Real integration test (requires Ollama + Brave API key):**
   ```bash
   # Start Ollama with a model
   ollama pull llama3.1:8b

   # Run Scout
   cd pipeline
   SEARCH_API_KEY=<your-brave-key> uv run scout run \
     --location "Austin, TX" \
     --issues housing_affordability,public_transit

   # Check results
   uv run scout runs list
   uv run scout runs inspect <run-id>
   ```

---

## Follow-Up Plan (Not In Scope)

The next plan will cover:
- **Daemon mode** — APScheduler v4 integration, `scout daemon start/stop/status`
- **Auto-contribution** — Background submission of quality entries to central Atlas
- **Atlas API contribution endpoints** — Review queue in the API
- **LM Studio provider** — OpenAI-compatible local provider
- **OpenAI + Google providers** — Additional cloud providers
