# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Atlas is an open-source civic actor discovery platform. It finds people, organizations, and initiatives working on social issues across America, traces each to public sources, and presents them as a searchable, source-linked directory.

## Architecture

**Monorepo** managed by Turborepo with pnpm workspaces.

| Package | Stack | Port |
|---------|-------|------|
| `app/` | React 19 + TanStack Start + Vite + Nitro | 3000 |
| `api/` | FastAPI + Python 3.12 + SQLite (dev) / PostgreSQL (prod) | 8000 |
| `pipeline/` | Standalone discovery pipeline (Anthropic Claude API) | — |
| `mintlify/` | API documentation (Mintlify) | — |

**Frontend** uses TanStack Router (file-based routing in `app/src/routes/`), TanStack Query for data fetching, and Tailwind CSS 4. API types are generated from the OpenAPI spec via Orval (`app/src/lib/generated/`). SSR is handled by TanStack Start + Nitro.

**Backend** follows domain-driven design: `domains/catalog/` (entries, profiles, connections), `domains/access/` (auth), `domains/discovery/` (pipeline), `domains/moderation/` (flags). Each domain has `models/` (CRUD + data), `api/` (HTTP endpoints), and `schemas/` (Pydantic). Database access is async via `aiosqlite`/`psycopg` with raw SQL (no ORM). All SQL uses `?` placeholders; the PostgreSQL adapter translates to `%s` automatically.

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
cd api && uv run pytest                    # All API tests (90% coverage required)
cd api && uv run pytest tests/path.py -v   # Single test file
cd api && uv run pytest tests/path.py::TestClass::test_name -v  # Single test
cd app && pnpm vitest run                  # All frontend tests (80% coverage required)
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

**Scopes:** `api`, `app`, `pipeline`, `scout`, `docs`, `dx` — or omit for cross-cutting changes. Never use `shared` as a scope.

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
- **Python:** Line length 100. Async everywhere for I/O. Docstrings with Parameters/Returns (NumPy style). Test coverage minimum 90%.
- **TypeScript:** No `any` or `as any`. ESLint enforces this. Extract types rather than inline them.
- **API responses** use Pydantic models validated through `_entity_record()` in `platform/mcp/data.py`. New fields must be added to both the Pydantic schema (`schemas/public.py`) and the record builder.
- **Frontend API mapping** lives in `app/src/lib/api.ts`. The `mapEntity()` function converts generated OpenAPI types to the internal `Entry` type. New API fields must be mapped here.
