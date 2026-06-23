# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Atlas is an open-source civic actor discovery platform. It finds people, organizations, and initiatives working on social issues across America, traces each to public sources, and presents them as a searchable, source-linked directory.

## The First Principle: End-User Experience (read this first)

**This outranks every other instruction in this file.** Atlas's only real moat is the *experience* of using it — how it feels to find a person, trust what you see, understand how they connect, and act. **The end-user experience is the product, and it is the reason this nonprofit exists.** Everything else — schema, discovery pipeline, knowledge graph, API — is plumbing in service of it. It does not matter how efficient or complete our systems are if end users cannot feel the benefit.

Non-negotiable:

1. **Every technical and architectural decision must tie back to the end-user experience it enables or protects.** "Cleaner / more scalable / more correct / more complete" is never sufficient on its own — it must ladder up to something the user can see, trust, feel, or do. Say so in the PR, commit body, or design doc.
2. **We build complexity solely for the experience.** Complexity is a cost, never an achievement. A simpler system that delivers the same experience is always better. Never substitute depth or complexity for an emphasis on experience.
3. **There is no such thing as "back-end-only work."** A migration, a pipeline change, a job queue are product work, judged by the experience they produce.
4. **Trust is the core experience.** Wrong, stale, or unsourced data shown confidently is the worst outcome — an experience failure, not just a data bug.

Full statement: [docs/experience-first.md](docs/experience-first.md). When in doubt, optimize for what the user sees, trusts, and can do.

## Architecture

**Monorepo** managed by Turborepo with pnpm workspaces.

### Applications

| Directory | Stack | Port |
|-----------|-------|------|
| `app/` | React 19 + TanStack Start + Vite + Nitro | 3000 |
| `api/` | FastAPI + Python 3.12 + SQLite (dev) / PostgreSQL (prod) | 8000 |
| `scout/` | Atlas Scout CLI — autonomous discovery pipeline | — |
| `mintlify/` | API documentation (Mintlify) | — |

### Shared Libraries (Python)

| Directory | Package | Purpose |
|-----------|---------|---------|
| `libs/shared/` | `atlas-shared` | Pydantic models, types, and taxonomy shared by all Python packages |
| `libs/discovery-engine/` | `atlas-discovery-engine` | Extraction primitives, query generation, dedup, scoring, coverage analysis |

Both `api/` and `scout/` depend on these via editable path references in their `pyproject.toml` files.

**Frontend** uses TanStack Router (file-based routing in `app/src/routes/`), TanStack Query for data fetching, and Tailwind CSS 4. API types are generated from the OpenAPI spec via Orval (`app/src/lib/generated/`). SSR is handled by TanStack Start + Nitro.

**Backend** follows domain-driven design: `domains/catalog/` (entries, profiles, connections), `domains/access/` (auth), `domains/discovery/` (pipeline, scheduling, jobs), `domains/moderation/` (flags). Each domain has `models/` (CRUD + data), `api/` (HTTP endpoints), and `schemas/` (Pydantic). Database access is async via `aiosqlite`/`psycopg` with raw SQL (no ORM). All SQL uses `?` placeholders; the PostgreSQL adapter translates to `%s` automatically.

**Discovery pipeline** runs in two modes: the API hosts a durable job worker that polls for queued discovery jobs and executes them with lease-based claiming and retry, while Scout runs the same extraction logic locally with additional features (caching, iterative deepening, browser research). Both share extraction prompts, parsing, normalization, and validation through `atlas-discovery-engine`. Scheduled runs are triggered by Cloud Scheduler via `POST /api/discovery-runs/scheduled`.

**Route structure** uses pathless layout groups: `_public/` (open pages), `_workspace/` (authenticated), `_auth/` (sign-in flows). Profile pages are SSR at `/profiles/people/:slug` and `/profiles/organizations/:slug`.

## Commands

```bash
# Development
pnpm dev                          # Full stack (API + app + mail capture)
cd app && pnpm run dev            # App only
cd api && uv run uvicorn atlas.main:app --reload  # API only

# Quality (what pre-commit hook runs)
cd api && uv run ruff format .    # Format Python
cd api && uv run ruff check .     # Lint Python
cd api && uv run mypy atlas       # Type check Python
cd app && pnpm run format         # Format TypeScript
cd app && pnpm run lint           # Lint TypeScript
cd app && pnpm tsc --noEmit       # Type check TypeScript

# Tests
cd api && uv run pytest                    # All API tests (100% coverage required)
cd api && uv run pytest tests/path.py -v   # Single test file
cd api && uv run pytest tests/path.py::TestClass::test_name -v  # Single test
cd app && pnpm vitest run                  # All frontend tests (100% coverage required)
cd app && pnpm vitest run tests/unit/path  # Single test file
cd app && pnpm run test:e2e               # Playwright E2E

# Code generation
pnpm run openapi                  # Regenerate OpenAPI spec from FastAPI
cd app && pnpm run api-client     # Regenerate TypeScript types from OpenAPI spec

# Database
cd api && python3 -m atlas.db_init  # Initialize schema
make db-reset                       # Drop and recreate (deletes data)
```

## Commit Convention

Enforced by `.githooks/commit-msg`. Format: `type(scope)?: Description`

**Types:** `feat` (consumer-facing only), `fix` (consumer-facing), `docs`, `chore` (internal, tests, tooling), `refactor`

**Scopes:** `api`, `app`, `scout`, `docs`, `dx` — or omit for cross-cutting changes. Never use `shared` as a scope.

**Rules:**
- Description starts with capital letter
- `feat` is only for changes visible to end users — internal plumbing is `chore`
- Commit bodies are prose, not bullet lists or step enumerations

## Pre-commit Hook

The `.githooks/pre-commit` hook runs on staged files only:
- Python in `api/`: ruff format (auto-fix + re-stage) → ruff check (strict) → mypy (strict)
- TypeScript in `app/`: prettier (auto-fix + re-stage) → eslint (strict)

When staging files for commit, always `git restore --staged .` first, then `git add` specific files, then commit. This prevents stale staging state.

## Conventions

- **pnpm only.** Never use npm or yarn.
- **No inline type definitions.** Always extract types into named interfaces or use existing ones.
- **No fallbacks or silent defaults.** Fail explicitly. Work against defined specs, not guessed defaults.
- **No CSS `transform: scale()`.** Resize actual dimensions. No overlapping surfaces during transitions.
- **Python:** Line length 100. Async everywhere for I/O. Docstrings with Parameters/Returns (NumPy style). Test coverage gate is 100% (statements + branches) for `api/`, `scout/`, `libs/discovery-engine/`, and `libs/shared/`.
- **TypeScript:** No `any` or `as any`. ESLint enforces this. Extract types rather than inline them. Test coverage gate is 100% (statements + branches + functions + lines) for `app/`.
- **API responses** use Pydantic models validated through `_entity_record()` in `platform/mcp/data.py`. New fields must be added to both the Pydantic schema (`schemas/public.py`) and the record builder.
- **Frontend API mapping** lives in `app/src/lib/api.ts`. The `mapEntity()` function converts generated OpenAPI types to the internal `Entry` type. New API fields must be mapped here.
