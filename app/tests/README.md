# App tests

## Tiers

| Directory     | Runner                                     | What belongs here                                                |
| ------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `unit/`       | Vitest                                     | Everything that can run without a server. Mirrors `src/`.        |
| `acceptance/` | Playwright (`playwright.config.ts`)        | Flows through a real app + API + mailbox, started by the config. |
| `e2e/`        | Playwright (`playwright.hosted.config.ts`) | Smoke checks against an already-deployed environment.            |

`unit/` mirrors the `src/` tree: `src/domains/<d>/x.ts` is tested by
`unit/domains/<d>/x.test.ts`, `src/platform/…` by `unit/platform/…`, and route
files by `unit/routes/…` reproducing TanStack's filesystem naming, brackets and
all. Nothing lives in `src/`.

## Shared code

An eslint rule (`atlas-tests/no-test-file-locals`) forbids top-level
declarations and `export` in `*.test.ts(x)`: a test file holds imports,
`describe`/`it`/hooks, and `vi.mock`/`vi.hoisted` calls, nothing else. Anything
shared therefore has to live in one of three places:

| Directory   | Holds                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| `fixtures/` | Builders for domain data — `createAtlasSessionFixture`, `createEntryFixture`. |
| `mocks/`    | Reusable `vi.mock` module surfaces and sentinels.                             |
| `helpers/`  | Everything else: render harnesses, test beds, stubs.                          |

When shared code serves exactly one test file, put it beside that file as
`<subject>-test-support.ts(x)`. That is the only sanctioned colocation, and it
is still exempt from the lint rule above.

## Reach for these before writing your own

- `helpers/router-harness.tsx` — `installRouterMocks()` is the **only**
  sanctioned way to mock `@tanstack/react-router`. It covers `Link`,
  `createFileRoute`, `useNavigate`, `useRouter`, `useRouterState`, `redirect`
  and `Outlet`. Read the live mocks with `readRouterMocks()`. Do not hand-roll a
  `Link` stub: assertions then disagree file to file about whether the target
  lands in `href` or in `data-link-to`.
- `helpers/render-with-providers.tsx` — `renderWithProviders(ui)` mounts the
  QueryClient, toast and confirm-dialog providers a component actually needs.
  Prefer it over mocking the whole of `@tanstack/react-query`; a component
  asserted against your own stub is not really under test.
- `helpers/stub-fetch.ts` — `stubFetch(...)` installs a `fetch` mock and records
  the requests. `unstubGlobals` unwinds it.
- `helpers/server-fn-stub.ts` — for anything built with `createServerFn`.
- `fixtures/access/sessions.ts` — sessions, workspaces, memberships,
  capabilities.

## What the runner already does for you

`setup.ts` and `vitest.config.ts` handle these globally; do not repeat them per
file:

- `@testing-library/jest-dom` matchers, and `cleanup()` after every test.
- jsdom gaps: `matchMedia`, `ResizeObserver`, `IntersectionObserver`,
  `navigator.clipboard`, `localStorage`, `HTMLFormElement.requestSubmit`.
- `clearMocks`, `unstubEnvs`, `unstubGlobals` between tests. Implementations
  survive, so `describe`-level setup still holds; only call history resets.
- `TZ=UTC`, so date assertions read the same here as on CI.

The default environment is **node**. A file that touches the DOM needs
`// @vitest-environment jsdom` on its first line, or it fails with
`document is not defined`.

## Coverage

The gate is real: `pnpm test` runs with `--coverage` and fails below the
thresholds in `vitest.config.ts`. Those thresholds are a ratchet climbing toward
100 — raise them when you earn it, never lower them to land a change.
`coverage.include` names the whole product surface, so a file with no test
counts against you rather than vanishing from the report. Exclusions are for
code exercised by another gate entirely (the Playwright harness, build scripts),
and each one says so in a comment.
