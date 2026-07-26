# TypeScript Testing Standards

> **How TypeScript tests are organized, run, and gated in this repository.**

Language-agnostic principles live in
[Testing Organization Standards](./testing-organization-standards.md). This
document covers what is specific to TypeScript here: the runner, the layout, and
the coverage gate as they actually exist.

The `app/` workspace is the reference implementation, and
[`app/tests/README.md`](../../app/tests/README.md) is its operational guide —
read that before writing a test there, since it lists the shared helpers you are
expected to reuse.

---

## Runner

Vitest, configured per workspace. `app/vitest.config.ts` is the fullest example;
the `packages/*` workspaces build on the shared presets in
`packages/vitest-config` (`nodeVitestConfig` and `reactVitestConfig`).

The default environment is **node**. A file that touches the DOM opts in with a
docblock on its first line:

```ts
// @vitest-environment jsdom
```

Forgetting it produces a confusing `document is not defined`, so check it first
when a component test fails to start.

## Layout

Tests live under `tests/`, never in `src/`, and mirror the source tree:
`src/domains/<d>/x.ts` is tested by `tests/unit/domains/<d>/x.test.ts`. Route
files reproduce TanStack's filesystem naming, bracket escapes included.

| Directory     | Runner     | Scope                                              |
| ------------- | ---------- | -------------------------------------------------- |
| `unit/`       | Vitest     | Anything that runs without a server.               |
| `acceptance/` | Playwright | Flows through a real app, API and mailbox.         |
| `e2e/`        | Playwright | Smoke checks against an already-deployed instance. |

## Shared code

In `app/`, an eslint rule (`atlas-tests/no-test-file-locals`) forbids top-level
declarations and `export` inside `*.test.ts(x)`. A test file contains imports,
`describe`/`it`/hooks, and `vi.mock`/`vi.hoisted` calls — nothing else. Shared
code therefore belongs in `tests/fixtures/`, `tests/mocks/` or `tests/helpers/`,
or beside its single consumer as `<subject>-test-support.ts(x)`.

The rule exists to stop the same setup being re-invented per file. Before adding
a stub, check whether one already exists. There must be exactly one way to stub
a given dependency: rival stubs make assertions for the same behaviour disagree
across files, and a stub that drifts from the real thing lets tests assert
something no user can reach.

## Mocking

Mock at the boundary, not around the subject. A test that replaces a component's
children with `<div data-testid=…/>` and then asserts a prop was forwarded
verifies the test's own stub, not the product. Prefer rendering the real tree
and asserting on what a reader sees.

Where a component needs providers — a QueryClient, toasts, confirm dialogs —
mount them rather than mocking the library that reads them.

## Coverage

`app/`'s `test` script runs with `--coverage` and fails below the thresholds in
`app/vitest.config.ts`, so CI enforces the gate through the ordinary test task
rather than a separate one. This mirrors `api/pyproject.toml`, which puts
`--cov-fail-under` in `addopts` for the same reason.

Two rules matter more than the number:

1. **Set `coverage.include`.** Without it Vitest reports only the files a test
   imports, so a source file nobody tests drops out of the denominator instead
   of counting against you — and deleting a file's last test _raises_ coverage.
   Name the whole product surface explicitly.
2. **Thresholds ratchet upward only.** Raise them when a change earns it. Never
   lower one to land a change; that turns the gate into decoration.

Exclusions are for code a different gate already covers — the Playwright-only
hosted auth harness, build and deploy scripts. Each exclusion carries a comment
naming what does exercise it. For a genuinely unreachable line, such as an
`import.meta.url === process.argv[1]` entry-point guard that is false whenever a
test imports the module, prefer a `/* v8 ignore */` comment explaining why over
an exclusion glob, so the reason travels with the code.
