# Turborepo

[Docs](../README.md) > [Development](./README.md) > Turborepo

Atlas uses [Turborepo](https://turbo.build/repo) to orchestrate tasks across the
monorepo. It handles dependency ordering between tasks, caches results to skip
redundant work, and runs independent tasks in parallel.

## How It Works

Turborepo reads `turbo.json` at the repo root (and `app/turbo.json` which
extends it) to understand the task graph. When you run a task, Turbo:

1. Hashes the task's inputs (source files, dependencies, env vars)
2. Checks the cache for a matching hash
3. If cached: replays the output instantly
4. If not cached: runs the task and stores the result

This means unchanged tasks complete in milliseconds on repeat runs.

## Configuration

There are two config files:

| File             | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `turbo.json`     | Root config. Defines shared package task defaults and narrow root tasks |
| `app/turbo.json` | App package config. Extends root, adds app-specific tasks               |

### Env Mode

Atlas uses `"envMode": "strict"`, which means Turbo only passes environment
variables that are explicitly listed in each task's `env` array. This prevents
accidental cache pollution from unrelated env changes.

### Global Dependencies

These files invalidate the cache for every task when changed:

- `pnpm-workspace.yaml`
- `package.json`
- `api/pyproject.toml`

## Task Graph

### Root Command Menu

The root `package.json` is intentionally small. Use it for common repo-wide
workflows only:

| Command                  | Purpose                                |
| ------------------------ | -------------------------------------- |
| `pnpm run quality`       | Repo quality graph                     |
| `pnpm run test:coverage` | Python package tests plus app coverage |
| `pnpm run verify`        | Full production verification workflow  |

Narrow root-level Turbo tasks (prefixed with `//#`) are reserved for operations
that read repo-level files outside a single workspace package.

| Task                  | Purpose                             | Inputs                                        |
| --------------------- | ----------------------------------- | --------------------------------------------- |
| `//#openapi`          | Export OpenAPI spec from Python API | `api/atlas/**/*.py`, `api/pyproject.toml`     |
| `//#contract:test`    | Run contract tests                  | `api/**`, OpenAPI spec                        |
| `//#compose:validate` | Validate Docker Compose config      | `compose.yaml`, env examples, Caddyfile       |
| `//#secrets:scan`     | Scan for leaked secrets             | `.secrets.baseline`, env examples, lock files |
| `//#e2e:api`          | Start API E2E server                | `api/**`, OpenAPI spec (persistent)           |

### Package Tasks

These run within workspace packages:

| Task            | Purpose                                      | Key Detail                                     |
| --------------- | -------------------------------------------- | ---------------------------------------------- |
| `build`         | Production build                             | Depends on `api-client`                        |
| `api-client`    | Generate TypeScript client from OpenAPI spec | Output: `src/lib/generated/atlas.ts`           |
| `openapi:lint`  | Lint the OpenAPI spec                        | Uses `.spectral.yaml`                          |
| `typecheck`     | TypeScript type checking                     | Depends on `api-client`                        |
| `lint`          | ESLint                                       | Depends on `api-client`                        |
| `test`          | Vitest unit tests                            | Depends on `api-client`                        |
| `test:coverage` | Tests with coverage report                   | Output: `coverage/**`                          |
| `test:e2e`      | Playwright E2E tests                         | Not cached                                     |
| `quality`       | All quality checks                           | Depends on `typecheck`, `lint`, `format:check` |
| `dev`           | Dev server                                   | Persistent, not cached                         |

### Dependency Chain

Many app tasks depend on `api-client`, which depends on `//#openapi`. This means
changing Python API code triggers:

```
Python source changed
  → //#openapi (re-export spec)
    → app#api-client (re-generate TS client)
      → app#typecheck, app#lint, app#test, app#build
```

Turbo handles this ordering automatically.

## Caching

### What Gets Cached

By default, all tasks are cached. Tasks explicitly marked `"cache": false` are
excluded (dev servers, E2E tests). The cache key includes:

- Source files in the package (or listed in `inputs`)
- Dependencies (other tasks this task depends on)
- Environment variables listed in `env`
- Global dependencies

### Local Cache

The local cache lives in `node_modules/.cache/turbo`. It works out of the box
with no setup.

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

### GitHub Actions Cost Control

GitHub Actions starts CI with `scripts/ci/changed-surfaces.mjs`. That script
classifies the changed files once, then the workflow uses those outputs to skip
work that cannot affect the change:

- docs-only changes run docs validation and the secret scan
- Compose-only changes run Compose validation and the secret scan
- non-deploy GitHub Actions changes run workflow linting and the secret scan
- deploy-script and deploy-workflow changes run deploy script validation, then
  staging deploy and hosted smoke on `main`
- app changes run app quality, app tests, acceptance, and hosted smoke
- API or shared Python changes run Python quality, Python tests, contract,
  OpenAPI drift, acceptance, API deploy, and hosted smoke
- production release tags always run the full gate

CodeQL is also path-gated for push and pull request events so docs-only,
Mintlify-only, Compose-only, and env-example-only changes do not start a
two-language security scan. The scheduled weekly CodeQL scan still runs
regardless of changed paths.

Keep this classifier aligned with `turbo.json`, package `turbo.json` files, and
the deploy workflows. If a new package can affect the hosted app or API, add it
to the classifier before relying on CI to skip work.

PR quality checks use Turbo `--affected` when the classifier proves the run is
not a full-gate run. Staging and production still rely on explicit surface gates
so hosted deploy behavior stays predictable.

Cheap-path jobs should keep their setup cheap: docs validation installs only the
`docs` workspace, Compose validation runs the shell script directly, workflow
linting skips workspace dependency install, deploy script validation skips
Python, and the credential scan sets up Python/uv without installing the pnpm
workspace.

The Python packages also declare their local package relationships in
`package.json` with `workspace:*` dependencies. Those links mirror the
`pyproject.toml` path dependencies and are required for Turbo affected mode to
fan shared-library changes out to API, Scout, and discovery-engine tests.

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

# Run the full production verification workflow
pnpm run verify

# Force run (ignore cache)
pnpm turbo run typecheck --force

# Dry run (show what would execute)
pnpm turbo run typecheck --dry
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
pnpm turbo run typecheck --graph

# Show verbose output including cache status
pnpm turbo run typecheck --verbosity=2

# See what inputs Turbo hashes for a task
pnpm turbo run typecheck --summarize
```

## Adding a New Task

1. Add the script to the relevant `package.json`
2. Add the task definition to `turbo.json` (root tasks) or `app/turbo.json` (app
   tasks)
3. Specify `inputs` if the task only reads a subset of files
4. Specify `outputs` if the task produces files (e.g., `dist/**`, `coverage/**`)
5. Specify `env` if the task reads environment variables (required by strict env
   mode)
6. Add `dependsOn` if the task must run after other tasks
7. Set `"cache": false` only for tasks with side effects (dev servers, E2E
   cleanup)
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
      "env": ["MY_ENV_VAR"],
    },
  },
}
```

## See Also

- [Code Quality](./code-quality.md) -- Quality gates and git hooks
- [Workflow](./workflow.md) -- Branch naming, commits, PR process
- [Turbo documentation](https://turbo.build/repo/docs)

---

Last updated: April 21, 2026
