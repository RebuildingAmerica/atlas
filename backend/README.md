# The Atlas Backend

A FastAPI + SQLite backend for The Atlas — a discovery platform for people, organizations, and initiatives working on contemporary American issues.

## Setup

### Installation

1. Create a virtual environment:
   ```bash
   python3.12 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install the package in development mode:
   ```bash
   pip install -e ".[dev]"
   ```

### Environment Variables

Create a `.env` file in the backend directory:

```env
DATABASE_URL=sqlite:///atlas.db
ANTHROPIC_API_KEY=your-api-key-here
SEARCH_API_KEY=optional-search-api-key
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000"]
LOG_LEVEL=info
ENVIRONMENT=dev
```

## Running

### Development Server

```bash
uvicorn atlas.main:app --reload
```

The API will be available at `http://localhost:8000`

- OpenAPI docs: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Health check: `http://localhost:8000/health`

### Production Server

```bash
uvicorn atlas.main:app --host 0.0.0.0 --port 8000
```

## Testing

Run the test suite:

```bash
pytest
```

Run with coverage:

```bash
pytest --cov=atlas --cov-report=html
```

Run specific tests:

```bash
pytest tests/test_taxonomy.py
pytest tests/test_database.py -v
pytest tests/test_api.py -k test_create_entry
```

## Code Quality

Run linter:

```bash
ruff check .
```

Run type checker:

```bash
mypy atlas
```

Format code:

```bash
ruff format .
```

Run all checks:

```bash
ruff check . && mypy atlas && pytest
```

## Project Structure

```
backend/
├── atlas/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # Settings via pydantic-settings
│   ├── pipeline/               # 6-step autodiscovery pipeline
│   │   ├── query_generator.py  # Step 1: location + issues → queries
│   │   ├── source_fetcher.py   # Step 2: queries → fetched sources
│   │   ├── extractor.py        # Step 3: sources → structured entries
│   │   ├── deduplicator.py     # Step 4: merge duplicates
│   │   ├── ranker.py           # Step 5: rank entries
│   │   └── gap_analyzer.py     # Step 6: identify gaps
│   ├── models/                 # Data models and CRUD
│   │   ├── database.py         # SQLite schema and init
│   │   ├── entry.py            # Entry CRUD
│   │   ├── source.py           # Source CRUD
│   │   └── discovery_run.py    # Pipeline run tracking
│   ├── taxonomy/               # Issue area taxonomy
│   │   ├── issue_areas.py      # All 47 issue areas
│   │   └── search_terms.py     # Search keyword mappings
│   ├── api/                    # REST API endpoints
│   │   ├── router.py           # Main router
│   │   ├── entries.py          # Entry endpoints
│   │   ├── discovery.py        # Discovery run endpoints
│   │   └── taxonomy.py         # Taxonomy endpoints
│   └── schemas/                # Pydantic request/response models
│       ├── entry.py
│       ├── source.py
│       └── discovery.py
├── tests/
│   ├── conftest.py             # Shared fixtures
│   ├── test_database.py        # Database and CRUD tests
│   ├── test_taxonomy.py        # Taxonomy tests
│   └── test_api.py             # API endpoint tests
└── pyproject.toml              # Project configuration
```

## Architecture

### Three-Layer Design

1. **Autodiscovery Pipeline** — converts location + issue areas into structured entries via 6-step process
2. **Storage Layer** — SQLite with FTS5 full-text search
3. **Interface Layer** — REST API with filtering, search, and taxonomy navigation

### Data Model

**Entry**: Core entity (person, organization, initiative, campaign, event)
- Tied to location (city, state, region, geo_specificity)
- Tagged with issue areas (many-to-many)
- Linked to sources (many-to-many)
- Contact surface (website, email, phone, social media)
- Internal fields (contact status, editorial notes, priority)

**Source**: Web articles, documents, and other content
- Extracted from via pipeline
- Linked to entries via junction table
- Stores raw content for re-extraction

**DiscoveryRun**: Pipeline execution tracking
- Location + issue areas queried
- Metrics: queries generated, sources fetched, entries extracted
- Status: running, completed, failed

### 11 Domains, 47 Issue Areas

Taxonomy from Rebuilding America series:
- Economic Security (5 areas)
- Housing and the Built Environment (4)
- Climate and Environment (5)
- Democracy and Governance (5)
- Technology and Information (5)
- Education (4)
- Health and Social Connection (5)
- Infrastructure and Public Goods (5)
- Justice and Public Safety (4)
- Rural-Urban Divide (4)
- Labor and Worker Power (5)

Each issue area has multiple search term variations for query generation.

## API Endpoints

### Health
- `GET /health` — Health check

### Entries
- `GET /api/v1/entries` — List entries (with filtering, search, pagination)
- `GET /api/v1/entries/{id}` — Get entry details
- `POST /api/v1/entries` — Create entry
- `PATCH /api/v1/entries/{id}` — Update entry
- `DELETE /api/v1/entries/{id}` — Delete entry

Query parameters for listing:
- `state` — Filter by state (2-letter code)
- `city` — Filter by city
- `entry_type` — Filter by type (person, organization, etc.)
- `issue_area` — Filter by issue area slug
- `search` — Full-text search query
- `active_only` — Only active entries (default: true)
- `limit` — Results per page (default: 100, max: 1000)
- `offset` — Pagination offset (default: 0)

### Discovery Runs
- `POST /api/v1/discovery/run` — Start discovery run (202 Accepted)
- `GET /api/v1/discovery/runs` — List runs
- `GET /api/v1/discovery/runs/{id}` — Get run details

### Taxonomy
- `GET /api/v1/taxonomy` — Full taxonomy (all domains and issues)
- `GET /api/v1/taxonomy/{domain}` — Issues for a domain

## Dependencies

**Core**:
- `fastapi` — Web framework
- `uvicorn[standard]` — ASGI server
- `httpx` — HTTP client
- `anthropic` — Claude API
- `pydantic` — Data validation
- `pydantic-settings` — Settings management
- `trafilatura` — HTML-to-text extraction
- `aiosqlite` — Async SQLite

**Dev**:
- `pytest` — Testing
- `pytest-asyncio` — Async test support
- `pytest-cov` — Coverage reporting
- `ruff` — Linter and formatter
- `mypy` — Type checking
- `pre-commit` — Git hooks

## Design Decisions

### Async-First
All database operations are async via `aiosqlite`. API endpoints use async/await for scalability.

### Type Annotations
Every function has complete type annotations. Mypy runs in strict mode.

### SQLite + FTS5
Suitable for Phase 1-2. Full-text search via SQLite's built-in FTS5 virtual table. Upgrade to Postgres when concurrent public access is needed.

### 47 Issue Areas
Not 48 or 50 — exactly matching Rebuilding America series taxonomy. Cross-tagging is encouraged (entries can be tagged with multiple areas across domains).

### Stub Pipeline Steps
Steps 2-6 of the pipeline are implemented as stubs with proper signatures. Ready to fill in when APIs are available (web search, Claude, etc.).

## Next Steps

1. Implement pipeline steps 2-6 (source fetching, extraction, deduplication, ranking, gap analysis)
2. Add authentication and authorization
3. Build React frontend for triage and editing
4. Implement batch operations for managing entries
5. Add CSV export and import
6. Deploy to production with Postgres

## License

MIT
