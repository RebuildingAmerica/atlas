# Turborepo

[Docs](../README.md) > [Development](./README.md) > Turborepo

Atlas uses [Turborepo](https://turbo.build/repo) to orchestrate tasks across the monorepo. It handles dependency ordering between tasks, caches results to skip redundant work, and runs independent tasks in parallel.

## How It Works

Turborepo reads `turbo.json` at the repo root (and `app/turbo.json` which extends it) to understand the task graph. When you run a task, Turbo:

1. Hashes the task's inputs (source files, dependencies, env vars)
2. Checks the cache for a matching hash
3. If cached: replays the output instantly
4. If not cached: runs the task and stores the result

This means unchanged tasks complete in milliseconds on repeat runs.

## Configuration

There are two config files:

| File | Purpose |
|---|---|
| `turbo.json` | Root config. Defines shared tasks and root-level tasks (`//#` prefix) |
| `app/turbo.json` | App package config. Extends root, adds app-specific tasks |

### Env Mode

Atlas uses `"envMode": "strict"`, which means Turbo only passes environment variables that are explicitly listed in each task's `env` array. This prevents accidental cache pollution from unrelated env changes.

### Global Dependencies

These files invalidate the cache for every task when changed:

- `pnpm-workspace.yaml`
- `package.json`
- `api/pyproject.toml`

## Task Graph

### Root-Level Tasks

Root-level tasks (prefixed with `//#`) run scripts defined in the root `package.json` and operate on files outside any workspace package.

| Task | Purpose | Inputs |
|---|---|---|
| `//#openapi` | Export OpenAPI spec from Python API | `api/atlas/**/*.py`, `api/pyproject.toml` |
| `//#api:test` | Run Python API tests | `api/**`, OpenAPI spec |
| `//#contract:test` | Run contract tests | `api/**`, OpenAPI spec |
| `//#compose:validate` | Validate Docker Compose config | `compose.yaml`, env examples, Caddyfile |
| `//#secrets:scan` | Scan for leaked secrets | `.secrets.baseline`, env examples, lock files |
| `//#e2e:api` | Start API E2E server | `api/**`, OpenAPI spec (persistent) |
| `//#prod:verify` | Full production verification | Depends on all other tasks |

### Package Tasks

These run within workspace packages (currently just `app`):

| Task | Purpose | Key Detail |
|---|---|---|
| `build` | Production build | Depends on `api-client` |
| `api-client` | Generate TypeScript client from OpenAPI spec | Output: `src/lib/generated/atlas.ts` |
| `openapi:lint` | Lint the OpenAPI spec | Uses `.spectral.yaml` |
| `typecheck` | TypeScript type checking | Depends on `api-client` |
| `lint` | ESLint | Depends on `api-client` |
| `test` | Vitest unit tests | Depends on `api-client` |
| `test:coverage` | Tests with coverage report | Output: `coverage/**` |
| `test:e2e` | Playwright E2E tests | Not cached |
| `quality` | All quality checks | Depends on `typecheck`, `lint`, `format:check` |
| `dev` | Dev server | Persistent, not cached |

### Dependency Chain

Many app tasks depend on `api-client`, which depends on `//#openapi`. This means changing Python API code triggers:

```
Python source changed
  → //#openapi (re-export spec)
    → app#api-client (re-generate TS client)
      → app#typecheck, app#lint, app#test, app#build
```

Turbo handles this ordering automatically.

## Caching

### What Gets Cached

By default, all tasks are cached. Tasks explicitly marked `"cache": false` are excluded (dev servers, E2E tests). The cache key includes:

- Source files in the package (or listed in `inputs`)
- Dependencies (other tasks this task depends on)
- Environment variables listed in `env`
- Global dependencies

### Local Cache

The local cache lives in `node_modules/.cache/turbo`. It works out of the box with no setup.

To clear it:

```bash
pnpm turbo run build --force  # Ignore cache for this run
```

Or delete the cache directory:

```bash
rm -rf node_modules/.cache/turbo
```

### Remote Cache

Remote caching shares the cache across machines and CI. To enable:

```bash
# 1. Log in to Vercel
pnpm turbo login

# 2. Link this repo to your Vercel team
pnpm turbo link
```

Once linked, cached results are shared across all team members and CI runs.

## Running Tasks

### Via Make (Recommended)

Most developers should use Make, which calls Turbo under the hood:

```bash
make quality    # turbo run typecheck lint test
make test       # turbo run test
make typecheck  # turbo run typecheck
make lint       # turbo run lint
```

### Via Turbo Directly

For more control, run Turbo directly:

```bash
# Run a single task
pnpm turbo run typecheck

# Run multiple tasks
pnpm turbo run typecheck lint test

# Target a specific package
pnpm turbo run app#build

# Run a root-level task
pnpm turbo run //#api:test

# Run the full production verification graph
pnpm turbo run //#prod:verify

# Force run (ignore cache)
pnpm turbo run typecheck --force

# Dry run (show what would execute)
pnpm turbo run //#prod:verify --dry
```

### Filtering

```bash
# Only run tasks in the app package
pnpm turbo run build --filter=app

# Run tasks affected by changes since main
pnpm turbo run test --filter=...[main]
```

### Debugging

```bash
# Show the task graph
pnpm turbo run //#prod:verify --graph

# Show verbose output including cache status
pnpm turbo run typecheck --verbosity=2

# See what inputs Turbo hashes for a task
pnpm turbo run typecheck --summarize
```

## Adding a New Task

1. Add the script to the relevant `package.json`
2. Add the task definition to `turbo.json` (root tasks) or `app/turbo.json` (app tasks)
3. Specify `inputs` if the task only reads a subset of files
4. Specify `outputs` if the task produces files (e.g., `dist/**`, `coverage/**`)
5. Specify `env` if the task reads environment variables (required by strict env mode)
6. Add `dependsOn` if the task must run after other tasks
7. Set `"cache": false` only for tasks with side effects (dev servers, E2E cleanup)
8. Set `"persistent": true` for long-running tasks (dev servers, watch mode)

Example:

```jsonc
// In app/turbo.json
{
  "tasks": {
    "new-task": {
      "dependsOn": ["api-client"],
      "inputs": ["src/**/*.ts", "config.json"],
      "outputs": ["out/**"],
      "env": ["MY_ENV_VAR"]
    }
  }
}
```

## See Also

- [Code Quality](./code-quality.md) -- Quality gates and git hooks
- [Workflow](./workflow.md) -- Branch naming, commits, PR process
- [Turbo documentation](https://turbo.build/repo/docs)

---

Last updated: April 21, 2026
