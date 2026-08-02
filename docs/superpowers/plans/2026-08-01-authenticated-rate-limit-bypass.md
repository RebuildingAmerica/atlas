# Authenticated Rate-Limit Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure verified Atlas accounts, API keys, and Scout worker tokens
never consume anonymous rate-limit buckets while invalid credentials remain
throttled.

**Architecture:** The app proxy forwards credential-bearing traffic to the API
because only the API can validate Atlas credentials. The API admits trusted
internal actors immediately, then uses bounded per-client verification admission
for other credentials. Credential capacity is reserved before unknown
verification work and refunded on success; failed credentials retain that
capacity and continue into anonymous admission control.

**Tech Stack:** TypeScript, TanStack Start server proxy, Python 3.12,
FastAPI/Starlette middleware, Vitest, pytest.

## Global Constraints

- Preserve anonymous rate limits for requests without credentials.
- Preserve credential-attempt and anonymous limits for credentials that fail
  validation.
- Never retain or log raw API keys, bearer tokens, or client addresses.
- Keep the API as the authoritative credential trust boundary.
- Bound rotating invalid credentials before JWT/JWKS work or remote
  introspection.
- Serialize concurrent verification per client without retaining raw client
  addresses.
- Use behavioral tests, pnpm, async Python I/O, and the repository's existing
  formatting and typing rules.

---

### Task 1: Lock the trust-boundary behavior with failing tests

**Files:**

- Modify: `api/tests/platform/test_anonymous_rate_limit_credentials.py`
- Modify: `app/tests/unit/domains/access/server/api-proxy/rate-limit.test.ts`

**Interfaces:**

- Consumes: `AnonymousRateLimitMiddleware.dispatch()` and
  `proxyAtlasApiRequest()`.
- Produces: Regression coverage proving valid credentials exceed anonymous and
  credential limits while invalid credentials remain bounded.

- [ ] **Step 1: Tighten the valid JWT and API-key tests**

Set `anonymous_credential_rate_limit_per_minute=1` and issue at least two valid
authenticated requests. Assert every response succeeds. The production change
that makes these tests pass is admitting a verified credential before reserving
anonymous credential buckets.

- [ ] **Step 2: Change the proxy credential test to require forwarding**

Rename the test to
`forwards credential-bearing requests to the API without spending anonymous proxy buckets`,
make two requests above a one-request anonymous limit, and assert both return
`200` and both reach `fetch`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cd api && uv run pytest -o addopts='' tests/platform/test_anonymous_rate_limit_credentials.py -v
cd app && pnpm vitest run tests/unit/domains/access/server/api-proxy/rate-limit.test.ts
```

Expected: the tightened valid-credential API tests and proxy forwarding test
fail with the second request returning `429`; invalid-credential tests remain
green.

### Task 2: Admit verified actors before anonymous controls

**Files:**

- Modify: `api/atlas/platform/http/anonymous_rate_limit.py`
- Modify: `api/atlas/platform/http/anonymous_rate_limit_support.py`
- Modify: `app/src/domains/access/server/api-proxy.ts`
- Test: `api/tests/platform/test_anonymous_rate_limit_credentials.py`
- Test: `app/tests/unit/domains/access/server/api-proxy/rate-limit.test.ts`

**Interfaces:**

- Consumes: `verify_api_key()`, `verify_bearer_jwt()`,
  `_API_KEY_CACHE_TTL_SECONDS`, and `_MAX_API_KEY_CACHE_ENTRIES`.
- Produces: `_has_valid_bearer(request: Request) -> bool` and proxy admission
  that defers credential validation to the API.

- [ ] **Step 1: Add a bounded bearer verification cache**

Add a private invalid-bearer cache entry carrying `expires_at: float`. Key
entries with `sha256(authorization).hexdigest()`, cache only failed
verification, prune by the existing TTL and entry cap, and never log or retain
the raw header. Successful tokens must be verified on every request so the cache
cannot outlive token expiry.

- [ ] **Step 2: Reorder API admission**

For limited requests, preserve the trusted-internal fast path. Other
credential-bearing requests must reserve credential verification capacity inside
the bounded per-client verification gate before calling
`_is_authenticated_request()`. Refund that reservation immediately when
validation succeeds. Failed credentials retain the reservation, emit the
invalid-credential event, and continue through anonymous read/write and hourly
buckets.

- [ ] **Step 3: Defer proxy credential validation to the API**

Treat the presence of `Authorization` or `X-API-Key` as a reason to skip only
the app proxy's anonymous bucket. Continue forwarding the headers unchanged so
the API can validate them and apply invalid-credential controls.

- [ ] **Step 4: Run the focused suites and verify GREEN**

Run the two commands from Task 1. Expected: all focused tests pass, including
the existing assertions that a forged API key or bearer token is verified only
once before throttling.

### Task 3: Verify the complete affected surface

**Files:**

- Modify: `docs/superpowers/plans/2026-08-01-authenticated-rate-limit-bypass.md`
  only to check completed steps.

**Interfaces:**

- Consumes: the completed API and app middleware behavior.
- Produces: release evidence for authenticated moderation and preserved
  anonymous protection.

- [ ] **Step 1: Run API rate-limit tests**

```bash
cd api && uv run pytest -o addopts='' tests/platform/test_anonymous_rate_limit_credentials.py tests/platform/test_anonymous_rate_limit_public.py tests/platform/test_anonymous_rate_limit_proxy.py tests/platform/test_anonymous_rate_limit_helpers.py -v
```

- [ ] **Step 2: Run app proxy tests and static checks**

```bash
cd app && pnpm vitest run tests/unit/domains/access/server/api-proxy
cd app && pnpm exec prettier --check src/domains/access/server/api-proxy.ts tests/unit/domains/access/server/api-proxy/rate-limit.test.ts
cd app && pnpm exec eslint --max-warnings 0 src/domains/access/server/api-proxy.ts tests/unit/domains/access/server/api-proxy/rate-limit.test.ts
```

- [ ] **Step 3: Run Python formatting, lint, and typing**

```bash
cd api && uv run ruff format --check atlas/platform/http/anonymous_rate_limit.py atlas/platform/http/anonymous_rate_limit_support.py tests/platform/test_anonymous_rate_limit_credentials.py
cd api && uv run ruff check atlas/platform/http/anonymous_rate_limit.py atlas/platform/http/anonymous_rate_limit_support.py tests/platform/test_anonymous_rate_limit_credentials.py
cd api && uv run mypy atlas
```

- [ ] **Step 4: Commit the implementation atomically**

Use the repository-required
`git restore --staged . && git add <exact paths> && git commit -F <message-file>`
chain. The commit message must state that authenticated discovery review no
longer stalls behind anonymous limits while invalid traffic remains protected.

- [ ] **Step 5: Verify production after the normal deployment path**

Issue more authenticated moderation writes than the previous threshold and
confirm none return `429`. Independently exercise anonymous traffic above its
configured threshold and confirm it still returns `429` with `Retry-After`.

### Task 4: Close pre-merge review findings

**Files:**

- Modify: `api/atlas/platform/http/anonymous_rate_limit.py`
- Modify: `api/atlas/platform/http/anonymous_rate_limit_support.py`
- Modify: `api/atlas/domains/catalog/api/org_resources_support.py`
- Modify: `api/atlas/domains/catalog/models/entry_search_helpers.py`
- Modify: `api/atlas/domains/access/api/lists_support.py`
- Test the corresponding middleware, public-directory, public-map, and
  saved-list surfaces.

- [ ] **Step 1: Prove rotating invalid credentials are bounded**

Use distinct API keys and bearer values from one client after a one-request
credential limit. Assert only the first value reaches verification. Exercise
concurrent requests for one valid API key and assert they both succeed with one
remote introspection.

- [ ] **Step 2: Add temporary reservation refund behavior**

Serialize credential checks through a fixed-size client-keyed lock stripe,
reserve credential capacity before verification, and refund it immediately on
success. Keep the reservation on every failed or errored verification.

- [ ] **Step 3: Normalize every source-linked database date boundary**

Use `date_string()` for entity details, public directories, public map records,
and saved-list exports. Exercise each affected public endpoint or output helper
with PostgreSQL-native `datetime` values.

- [ ] **Step 4: Run the complete gates and obtain a clean independent review**

Run focused affected suites, Ruff, MyPy, the full API suite, the app proxy
suite, frontend type checking, and then request a new review of the complete
branch before integration.
