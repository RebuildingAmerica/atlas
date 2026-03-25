# The Atlas

A national directory and autodiscovery engine for organizations, people, and initiatives working on transformative change across America.

## What Is The Atlas?

The Atlas is a searchable directory that helps people discover who's doing work on issues they care about — housing, labor, climate, democracy, justice — in any city or region across the country.

The core product is an **autodiscovery pipeline**: feed it a location and set of issues, and it searches the web, extracts structured data using AI, deduplicates results, and ranks them by relevance. Every entry traces back to the public sources where it came from.

**Current Phase:** Phase 1 (Scaffold) — Core APIs and database schema in place. Pipeline is stubbed. Frontend is built with routing and components.

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 20+
- Make

Full setup instructions: [Prerequisites](./docs/getting-started/prerequisites.md)

### 3-Step Setup

```bash
# 1. Clone and navigate to the project
cd atlas

# 2. Run first-time setup
make setup

# 3. Start development
make dev
```

- Backend API: http://localhost:8000
- Frontend: http://localhost:3000
- API Docs: http://localhost:8000/docs (Swagger)

## Documentation

Full documentation is in `docs/`:

- **[Getting Started](./docs/getting-started/README.md)** — New to the project? Start here
- **[Architecture](./docs/architecture/README.md)** — How the system is built
- **[Development Guide](./docs/development/README.md)** — Build features
- **[Standards](./docs/standards/README.md)** — Code style and conventions
- **[Design](./docs/design/README.md)** — Product vision and system design

Or jump to [docs/README.md](./docs/README.md) for the full documentation hub.

## Tech Stack

- **Backend:** Python 3.12 + FastAPI + SQLite (FTS5)
- **Frontend:** TanStack Start (React + TypeScript)
- **AI:** Anthropic Claude API for extraction
- **DevOps:** Docker Compose, Makefile, git hooks

## Development Commands

Common commands. Run `make help` for all:

```bash
make dev              # Start full stack (backend + frontend)
make dev-backend      # Start backend only
make dev-frontend     # Start frontend only

make quality          # Run all quality checks
make format           # Format code
make lint             # Lint code
make typecheck        # Type-check code
make test             # Run tests with coverage

make db-init          # Initialize database
make db-reset         # Reset database (deletes data)

docker compose up     # Run with Docker
```

## Project Structure

```
atlas/
├── backend/                  # Python/FastAPI backend
│   ├── atlas/
│   │   ├── api/              # REST endpoints
│   │   ├── models/           # Database models
│   │   ├── pipeline/         # Autodiscovery pipeline (6 steps)
│   │   ├── schemas/          # Pydantic schemas
│   │   └── taxonomy/         # Issue area definitions
│   └── tests/                # Test suite
│
├── frontend/                 # TanStack Start (React/TypeScript)
│   ├── src/
│   │   ├── routes/           # File-based routes
│   │   ├── components/       # Reusable components
│   │   ├── hooks/            # Custom hooks
│   │   ├── types/            # TypeScript types
│   │   └── lib/              # API client, utils
│
├── docs/                     # Documentation
│   ├── getting-started/      # Onboarding
│   ├── architecture/         # System design
│   ├── development/          # Development guide
│   ├── standards/            # Code standards
│   └── design/               # Product vision
│
├── .githooks/                # Git hooks (quality gates)
├── Makefile                  # Development commands
├── docker-compose.yml        # Multi-container setup
└── .env.example              # Environment template
```

For details: [Project Structure](./docs/getting-started/project-structure.md)

## Quality & Standards

All code is checked automatically:

- **Pre-commit hook:** Format, lint, types on every commit
- **Commit-msg hook:** Enforces Conventional Commits format
- **Pre-push hook:** Full test suite, 90%+ coverage, build succeeds

See [Code Quality](./docs/development/code-quality.md) for how to fix issues.

## Architecture

Three-layer design:

1. **Interface Layer** — REST API + React frontend
2. **Business Logic Layer** — FastAPI endpoints + autodiscovery pipeline
3. **Storage Layer** — SQLite database with FTS5 full-text search

The pipeline is the core: it takes a location and issue areas, searches the web, extracts entries using Claude AI, deduplicates, ranks, and identifies gaps.

See [System Overview](./docs/architecture/system-overview.md) for details.

## Contributing

1. Read the [Getting Started](./docs/getting-started/README.md) guide
2. Follow [Development Workflow](./docs/development/workflow.md)
3. Reference [Standards](./docs/standards/README.md) for code style
4. Write tests and ensure all quality checks pass

Commits must follow [Conventional Commits](./docs/standards/commit-messages.md) format. Hooks enforce this automatically.
