# Project Structure

[Docs](../README.md) > [Getting Started](./README.md) > Project Structure

A guided tour of the codebase. Where things live and when you'd work in them.

```
atlas/
├── api/                          # Python/FastAPI API
│   ├── atlas/                        # Main package
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI app initialization
│   │   ├── config.py                 # Configuration (env vars, API keys, etc.)
│   │   │
│   │   ├── api/                      # REST API route handlers
│   │   │   ├── router.py             # API router root
│   │   │   ├── entries.py            # GET/POST/PUT/DELETE endpoints for entries
│   │   │   ├── discovery.py          # POST /discovery endpoint to trigger pipeline
│   │   │   └── taxonomy.py           # GET endpoints for issue areas and search terms
│   │   │
│   │   ├── models/                   # Database models and CRUD operations
│   │   │   ├── database.py           # SQLite connection, schema initialization
│   │   │   ├── entry.py              # Entry model and CRUD (read, update)
│   │   │   ├── source.py             # Source model and CRUD
│   │   │   └── discovery_run.py      # DiscoveryRun model for tracking pipeline executions
│   │   │
│   │   ├── pipeline/                 # Autodiscovery pipeline (6-step process)
│   │   │   ├── __init__.py           # Main orchestrator that runs all 6 steps
│   │   │   ├── query_generator.py    # Step 1: Generate search queries
│   │   │   ├── source_fetcher.py     # Step 2: Fetch sources from web
│   │   │   ├── extractor.py          # Step 3: Use Claude API to extract structured data
│   │   │   ├── deduplicator.py       # Step 4: Deduplicate entries
│   │   │   ├── ranker.py             # Step 5: Rank by relevance
│   │   │   └── gap_analyzer.py       # Step 6: Analyze gaps in coverage
│   │   │
│   │   ├── schemas/                  # Pydantic request/response schemas
│   │   │   ├── entry.py              # Entry request/response schemas
│   │   │   ├── source.py             # Source schemas
│   │   │   └── discovery.py          # Discovery request/response schemas
│   │   │
│   │   └── taxonomy/                 # Issue area definitions
│   │       ├── issue_areas.py        # Issue area enum and definitions
│   │       └── search_terms.py       # Search terms for each issue area
│   │
│   ├── tests/                        # Test suite (pytest)
│   │   ├── conftest.py               # Pytest fixtures and configuration
│   │   ├── test_models.py            # Database model tests
│   │   ├── test_api.py               # API endpoint tests
│   │   ├── test_pipeline.py          # Pipeline integration tests
│   │   └── test_taxonomy.py          # Taxonomy tests
│   │
│   ├── pyproject.toml                # Python package config and dependencies
│   ├── Dockerfile                    # Container image for API
│   └── .gitignore                    # Python-specific ignores
│
├── app/                         # TanStack Start (React + TypeScript)
│   ├── src/
│   │   ├── entry.client.tsx          # Client entry point
│   │   ├── entry.server.tsx          # Server entry point
│   │   ├── router.tsx                # Router configuration
│   │   │
│   │   ├── routes/                   # File-based routes (TanStack Start convention)
│   │   │   ├── index.tsx             # Home page (/)
│   │   │   ├── __root.tsx            # Root layout (header, footer, etc.)
│   │   │   ├── search.tsx            # Search page (/search)
│   │   │   ├── entry/
│   │   │   │   └── $id.tsx           # Entry detail page (/entry/:id)
│   │   │   └── admin/                # Internal/admin pages (password-protected)
│   │   │       ├── __layout.tsx      # Admin layout
│   │   │       ├── index.tsx         # Admin dashboard (/admin)
│   │   │       └── discovery.tsx     # Run discovery pipeline (/admin/discovery)
│   │   │
│   │   ├── components/               # Reusable React components
│   │   │   ├── ui/                   # Low-level UI components (buttons, inputs, modals)
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   └── ...
│   │   │   │
│   │   │   └── features/             # Feature-level components (entry list, search form)
│   │   │       ├── EntryCard.tsx     # Display single entry
│   │   │       ├── EntryList.tsx     # Display list of entries
│   │   │       ├── SearchForm.tsx    # Search input form
│   │   │       └── ...
│   │   │
│   │   ├── hooks/                    # Custom React hooks
│   │   │   ├── useEntries.ts         # Fetch entries from API
│   │   │   ├── useSearch.ts          # Search entries
│   │   │   ├── useDiscovery.ts       # Trigger discovery pipeline
│   │   │   └── ...
│   │   │
│   │   ├── lib/                      # Utilities and API client
│   │   │   ├── api.ts                # API client (fetch wrapper)
│   │   │   ├── utils.ts              # Helper functions
│   │   │   └── constants.ts          # Shared constants
│   │   │
│   │   ├── types/                    # TypeScript types (mirror API Pydantic schemas)
│   │   │   ├── entry.ts              # Entry type definitions
│   │   │   ├── source.ts             # Source type definitions
│   │   │   └── ...
│   │   │
│   │   └── styles/                   # Global styles
│   │       └── index.css             # Global CSS
│   │
│   ├── app.config.ts                 # TanStack Start configuration
│   ├── vite.config.ts                # Vite build configuration
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── package.json                  # Node.js dependencies
│   ├── Dockerfile                    # Container image for app
│   └── .gitignore                    # Node-specific ignores
│
├── docs/                             # Documentation (this directory)
│   ├── README.md                     # Documentation hub (you are here)
│   ├── getting-started/              # Onboarding docs
│   ├── architecture/                 # System design and implementation
│   ├── development/                  # Development guide
│   ├── standards/                    # Engineering standards
│   ├── design/                       # Links to design docs
│   │
│   ├── the-atlas-product.md          # Product vision and problem statement
│   ├── the-atlas-system-design.md    # System architecture and data model
│   └── the-atlas-taxonomy.md         # Issue area definitions
│
├── .githooks/                        # Git hooks for quality enforcement
│   ├── pre-commit                    # Runs before each commit (format, lint, types)
│   ├── commit-msg                    # Validates commit message format
│   └── pre-push                      # Runs before push (full typecheck + tests)
│
├── .env.example                      # Template environment variables
├── .gitignore                        # Global ignore rules
├── .pre-commit-config.yaml           # Pre-commit framework config
├── docker-compose.yml                # Multi-container orchestration
├── Makefile                          # Development commands (make setup, make dev, etc.)
├── README.md                         # Project README
└── .git/                             # Git history
```

## Key Directories Explained

### api/atlas/api/

Where HTTP endpoints are defined. Add new features here:

- **entries.py** — Entry CRUD operations
- **discovery.py** — Trigger the autodiscovery pipeline
- **taxonomy.py** — Static data (issue areas, search terms)

**When to work here:** Adding new endpoints or changing API responses

### api/atlas/models/

Database models and how to read/write data. The single source of truth for
database schema.

- **database.py** — Database connection and initialization
- **entry.py** — Entry table and read/update operations
- **source.py** — Source table and operations

**When to work here:** Adding new database tables, changing schema, or adding
CRUD operations

### api/atlas/pipeline/

The heart of the product. Six steps that autodiscover entries.

1. **query_generator.py** — Generate dozens of search queries from location +
   issues
2. **source_fetcher.py** — Search web (news, nonprofits, etc.) for sources
3. **extractor.py** — Feed sources to Claude API, extract structured data
4. **deduplicator.py** — Merge duplicate entries (same person in multiple
   articles)
5. **ranker.py** — Rank entries by relevance to original query
6. **gap_analyzer.py** — Identify what's missing (underrepresented areas, person
   types)

The main orchestrator in `__init__.py` runs all 6 steps in sequence.

**When to work here:** Improving discovery quality, tweaking extraction logic,
or adding new pipeline steps

### api/atlas/taxonomy/

Issue areas (housing, labor, climate, etc.) and their search terms. Used by
query_generator to create targeted searches.

- **issue_areas.py** — All issue area definitions
- **search_terms.py** — Search terms per issue area

**When to work here:** Adding new issue areas or tweaking search terms for
existing ones

### app/src/routes/

File-based routing (TanStack Start convention). Each `.tsx` file is a route.

- `index.tsx` → `/` (home page)
- `search.tsx` → `/search`
- `entry/$id.tsx` → `/entry/:id`
- `admin/index.tsx` → `/admin`

**When to work here:** Adding new pages or changing URL structure

### app/src/hooks/

Custom React hooks that talk to the API API. Encapsulates data fetching and
state management.

**When to work here:** Adding new API calls or complex data logic

## Running Specific Parts

### API Only

```bash
make dev-api
```

Useful for API development without app overhead.

### App Only

```bash
make dev-app
```

Useful for UI development. Will call API through the Atlas local API origin.

### Tests

```bash
make test
```

Runs pytest (API) and pnpm test (app, if configured).

### Linting and Formatting

```bash
make lint           # Check for violations
make lint-fix       # Auto-fix issues
make format         # Format code
make format-check   # Check without changing
make typecheck      # Type check everything
```

## Architecture Layers

The project is organized in three logical layers:

1. **API Layer** (api/atlas/api/) — HTTP endpoints
2. **Business Logic Layer** (api/atlas/pipeline/, api/atlas/models/) — Core
   algorithms and data access
3. **Interface Layer** (app/) — What users see

This separation makes it easy to:

- Test business logic independently of HTTP
- Reuse business logic across different interfaces
- Change one layer without affecting others

## Next Steps

- Understand the complete architecture:
  [Architecture Overview](../architecture/README.md)
- Start developing: [Development Guide](../development/README.md)
- Learn standards: [Standards](../standards/README.md)

---

Last updated: March 25, 2026
