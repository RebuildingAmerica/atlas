# AGENTS.md

This file provides guidance to AI coding agents when working with code in this
repository.

## Project

Atlas is an open-source civic actor discovery platform. It finds people,
organizations, and initiatives working on social issues across America, traces
each to public sources, and presents them as a searchable, source-linked
directory.

## What Matters Most: The End-User Experience

**Read this before anything else in this file. It outranks every other
instruction here.** Atlas's reason to exist — and its only real moat — is the
_experience_ of using it. Anyone can assemble a database of civic actors; the
rows are a commodity, and dozens of datasets and "DB tools" already have them.
What sets Atlas apart is how it _feels_ to find a person, trust what you see,
understand how they connect to others, and act on it. **The end-user experience
is the product experience, and it is the reason this nonprofit exists.
Everything else — the schema, the discovery pipeline, the knowledge graph, the
API — is plumbing in service of it.** It does not matter how efficient, elegant,
or complete our systems are if end users cannot feel the benefit: an internal
improvement no user ever experiences is not an improvement. (Full statement:
[docs/experience-first.md](docs/experience-first.md) — the principle that
outranks all others in this repo.)

**Three rules that are not negotiable:**

1. **Every technical and architectural decision MUST be tied back to the
   end-user experience it enables or protects.** No exceptions. If you cannot
   name the concrete experience a change delivers, do not make it. "It's
   cleaner," "it's more scalable," "it's more correct," "it's more complete" are
   _not_ sufficient justifications on their own — each must ladder up to
   something the user can see, trust, feel, or do. State that tie explicitly
   wherever the decision is recorded: the PR, the commit body, the design doc,
   the code comment.
2. **Never substitute depth or complexity for experience.** Complexity is a cost
   we pay, never an achievement we celebrate. We build complex systems _solely_
   because — and only to the extent that — they produce a better experience for
   the end user. A simpler system that delivers the same experience is always
   the better system. Sophistication the user never feels is waste, and usually
   a liability. Never reach for the grander architecture when a smaller one
   gives the user the same thing sooner.
3. **There is no such thing as "back-end-only work."** A schema migration, a
   pipeline change, an index, a job queue are _product_ work, accountable to the
   experience they serve. "It's just backend" is never a reason to skip that
   accountability or to lower the bar on the polish, trust, and clarity the user
   ultimately feels. Every change, at every layer, is judged by the end-user
   experience it produces.

**Operational setup rule:** If any part of engineering or operations setup can
be automated and made turnkey, it must be automated in the repo. Manual setup is
only acceptable as a rare fallback for provider limits, permissions, or
break-glass recovery, and the fallback must point back to the automated path
that should normally own the work.

Apply it like this:

- **Judge work by its effect on the person using Atlas, not by how clean or
  impressive the backend is.** When you finish infrastructure work, answer:
  _what can the end user now see, trust, or do that they couldn't before?_ If
  you can't answer, the work isn't finished — or wasn't worth starting.
- **Trust is the core experience.** Atlas publishes claims about real, named
  people. Every surface must make it obvious where information came from and how
  confident we are. Data that is wrong, stale, or unsourced but shown
  confidently is the worst possible outcome — an experience failure, not merely
  a data bug.
- **Polish is not optional and not "later."** Loading, empty, and error states;
  copy; spacing; motion; perceived speed; the feel of search and navigation
  _are_ the product, not finishing touches. Hold them to the same bar as core
  features. (See _Copy and User-Facing Language_ and the design conventions
  below.)
- **When you must trade off, favor the user-facing outcome.** Ship the smaller
  backend that makes the experience better now over the grander one that
  delivers nothing the user can feel yet.

If a task ever feels purely "technical," stop and name the end-user outcome it
serves. If there isn't one, question whether it should be done at all.
Distinctive, trustworthy, delightful experience is the differentiator we protect
in every commit.

## Architecture

**Monorepo** managed by Turborepo with pnpm workspaces.

### Applications

| Directory   | Stack                                                    | Port |
| ----------- | -------------------------------------------------------- | ---- |
| `app/`      | React 19 + TanStack Start + Vite + Nitro                 | 3000 |
| `api/`      | FastAPI + Python 3.12 + SQLite (dev) / PostgreSQL (prod) | 8000 |
| `scout/`    | Atlas Scout CLI — autonomous discovery pipeline          | —    |
| `mintlify/` | API documentation (Mintlify)                             | —    |

### Shared Libraries (Python)

| Directory                | Package                  | Purpose                                                                    |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| `libs/shared/`           | `atlas-shared`           | Pydantic models, types, and taxonomy shared by all Python packages         |
| `libs/discovery-engine/` | `atlas-discovery-engine` | Extraction primitives, query generation, dedup, scoring, coverage analysis |

Both `api/` and `scout/` depend on these via editable path references in their
`pyproject.toml` files.

**Frontend** uses TanStack Router (file-based routing in `app/src/routes/`),
TanStack Query for data fetching, and Tailwind CSS 4. API types are generated
from the OpenAPI spec via Orval (`app/src/lib/generated/`). SSR is handled by
TanStack Start + Nitro.

**Backend** follows domain-driven design: `domains/catalog/` (entries, profiles,
connections), `domains/access/` (auth), `domains/discovery/` (pipeline,
scheduling, jobs), `domains/moderation/` (flags). Each domain has `models/`
(CRUD + data), `api/` (HTTP endpoints), and `schemas/` (Pydantic). Database
access is async via `aiosqlite`/`psycopg` with raw SQL (no ORM). All SQL uses
`?` placeholders; the PostgreSQL adapter translates to `%s` automatically.

**Discovery pipeline** runs in two modes: the API hosts a durable job worker
that polls for queued discovery jobs and executes them with lease-based claiming
and retry, while Scout runs the same extraction logic locally with additional
features (caching, iterative deepening, browser research). Both share extraction
prompts, parsing, normalization, and validation through
`atlas-discovery-engine`. Scheduled runs are triggered by Cloud Scheduler via
`POST /api/discovery-runs/scheduled`.

**Route structure** uses pathless layout groups: `_public/` (open pages),
`_workspace/` (authenticated), `_auth/` (sign-in flows). Profile pages are SSR
at `/profiles/people/:slug` and `/profiles/organizations/:slug`.

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

**Types:** `feat` (consumer-facing only), `fix` (consumer-facing), `docs`,
`chore` (internal, tests, tooling), `refactor`

**Scopes:** `admin`, `api`, `app`, `scout`, `docs`, `dx` — or omit for
cross-cutting changes. Never use `shared` as a scope.

**Rules:**

- Description starts with capital letter
- `feat` is only for changes visible to end users — internal plumbing is `chore`
- Commit bodies are prose, not bullet lists or step enumerations
- Keep `feat` and `fix` commit bodies high-level: explain the user-visible
  change and why it matters. Don't enumerate file-by-file diffs, internal
  helpers, refactor steps, or rename trails — that detail belongs in the PR
  description, not the commit history. Two or three short paragraphs is the
  ceiling.
- No phasing or roadmap meta in commit bodies ("Phase 1", "follow-on", "shipping
  in subsequent phases"). Each commit describes only what it does.

## Pre-commit Hook

The `.githooks/pre-commit` hook runs on staged files only:

- Python in `api/`: ruff format (auto-fix + re-stage) → ruff check (strict) →
  mypy (strict)
- TypeScript in `app/`: prettier (auto-fix + re-stage) → eslint (strict)

When staging files for commit, always `git restore --staged .` first, then
`git add` specific files, then commit. This prevents stale staging state.

## Shared Git Safety

This checkout is shared by multiple agents. Stashes may belong to another active
agent or preserve user work.

- Use a git worktree by default for any non-trivial implementation, audit fix,
  or multi-file edit. Keep the root `main` checkout as the clean sync and
  landing checkout so agents can rebase, verify, and recover without mixing
  unrelated work.
- Before editing from the root checkout, stop and create a named worktree under
  `/Users/williecubed/.config/superpowers/worktrees/atlas/` unless the user
  explicitly asks to work in place. This protects the user experience by keeping
  fixes reviewable, preserving other agents' work, and preventing
  release-critical changes from getting stuck behind unrelated local state.
- Do not merge `origin/main` into local work. Fetch and rebase so Atlas history
  stays linear, and verify `git rev-list --merges --count origin/main..HEAD` is
  `0` before saying sync or cleanup is done.
- Never run `git stash drop` or `git stash clear`.
- Do not delete stash entries, even if you created them, unless the user
  explicitly names the exact stash and asks you to delete it.
- If a temporary stash is needed, leave it in place and report its name/hash, or
  preserve it through a named ref when the user explicitly asks for cleanup.

## Copy and User-Facing Language

**No self-referential copy.** User-facing text must never describe what the
software is doing, explain its own behavior, or hedge about its own state.
Specifically banned:

- Describing data collection or pipeline state ("Atlas is still gathering...",
  "warming up", "will fill in as we find more")
- Referencing internal processes ("seeding the directory", "discovery pass",
  "catalog warming up")
- Explaining UI behavior to users ("runs are added to the list below", "the
  layout stays intact")
- Hedging empty states with implementation detail ("until then", "as Atlas finds
  more source-backed profiles")

Empty states should state the plain fact ("No people listed yet.") and nothing
else. Loading states should be silent (null/spinner) or a single neutral word.
Error states should tell the user what failed in plain language, not what the
system was trying to do.

## Conventions

- **pnpm only.** Never use npm or yarn.
- **Keep types colocated with the code that uses them.** Prefer named interfaces
  or type aliases in the same file or nearest module, and avoid dedicated
  `types.ts` buckets.
- **No fallbacks or silent defaults.** Fail explicitly. Work against defined
  specs, not guessed defaults.
- **Test behavior, not source text.** Tests should exercise observable behavior,
  public contracts, generated artifacts, database effects, or user-visible
  outcomes. Do not add one-off source scanning tests for implementation details
  or plan enforcement. Rare categorical exceptions are allowed only when the
  source text is itself the product contract, such as generated-code snapshots,
  migration invariants, lint-rule fixtures, or repository policy tooling.
- **No CSS `transform: scale()`.** Resize actual dimensions. No overlapping
  surfaces during transitions.
- **Python:** Line length 100. Async everywhere for I/O. Docstrings with
  Parameters/Returns (NumPy style). Test coverage gate is 100% for Python
  packages.
- **TypeScript:** No `any` or `as any`. ESLint enforces this. Extract types
  rather than inline them. Test coverage gate is 100% for the app.
- **API responses** use Pydantic models validated through `_entity_record()` in
  `platform/mcp/data.py`. New fields must be added to both the Pydantic schema
  (`schemas/public.py`) and the record builder.
- **Frontend API mapping** lives in `app/src/lib/api.ts`. The `mapEntity()`
  function converts generated OpenAPI types to the internal `Entry` type. New
  API fields must be mapped here.
