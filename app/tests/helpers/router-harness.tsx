import { vi } from "vitest";
import type { ComponentType, ReactNode } from "react";

/**
 * Generic shape of the route-options bag that route files pass to
 * `createFileRoute(...)({ ... })`.  Tests reach into this through `Route.options`.
 */
export interface RouteOptionsLike<TProps = Record<string, never>> {
  component?: ComponentType<TProps>;
  errorComponent?: ComponentType<TProps>;
  notFoundComponent?: ComponentType<TProps>;
  loader?: (...args: unknown[]) => unknown;
  loaderDeps?: (...args: unknown[]) => unknown;
  beforeLoad?: (...args: unknown[]) => unknown;
  validateSearch?: ((input: unknown) => unknown) | { parse: (input: unknown) => unknown };
  parseParams?: (input: Record<string, string>) => unknown;
  head?: (...args: unknown[]) => unknown;
  ssr?: boolean;
  staleTime?: number;
  server?: { handlers?: Record<string, (...args: unknown[]) => unknown> };
}

/**
 * Shape of the stub Route that test files import from a route module.  The
 * production Route type is replaced by our mock, so tests interact with this
 * generic shape.
 */
export interface RouteStub<TProps = Record<string, never>> {
  options: RouteOptionsLike<TProps>;
  useLoaderData: ReturnType<typeof vi.fn>;
  useSearch: ReturnType<typeof vi.fn>;
  useParams: ReturnType<typeof vi.fn>;
  useRouteContext: ReturnType<typeof vi.fn>;
  useRouterState: ReturnType<typeof vi.fn>;
}

/**
 * Casts a route module's exported `Route` to the test stub shape so component
 * accessors (`Route.options.component`) become callable JSX elements.  This
 * is a pure type-level helper; it does not modify the value at runtime.
 *
 * @param route - The `Route` value imported from a route module.
 */
export function asRouteStub<TProps = Record<string, never>>(route: unknown): RouteStub<TProps> {
  return route as RouteStub<TProps>;
}

/**
 * Hooks attached to the stub `Route` object that route files exercise via
 * `Route.useLoaderData()`, `Route.useSearch()`, `Route.useParams()`, and
 * `Route.useRouteContext()`. Tests drive these per case.
 */
export interface RouterMockHooks {
  useLoaderData: ReturnType<typeof vi.fn>;
  useSearch: ReturnType<typeof vi.fn>;
  useParams: ReturnType<typeof vi.fn>;
  useRouteContext: ReturnType<typeof vi.fn>;
  useRouterState: ReturnType<typeof vi.fn>;
}

interface RouterStateMockValue {
  location: {
    pathname: string;
  };
}

interface RouterStateMockOptions {
  select?: (state: RouterStateMockValue) => unknown;
}

export function routerPathnameState(pathname: string) {
  return ({ select }: RouterStateMockOptions = {}) => {
    const state: RouterStateMockValue = { location: { pathname } };
    return select ? select(state) : state;
  };
}

/**
 * Surface mocked from `@tanstack/react-router` for route-file tests.
 */
export interface RouterMockApi extends RouterMockHooks {
  redirect: ReturnType<typeof vi.fn>;
}

/**
 * Shape thrown by the stub `redirect()` helper.  Mirrors the production
 * contract closely enough for tests to assert on the redirect options.
 */
export interface RouterMockRedirectError extends Error {
  isRedirect: true;
  options: Record<string, unknown>;
}

/**
 * Props accepted by the mocked `<Link>` stub.
 */
export interface MockLinkProps {
  children: ReactNode;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  className?: string;
}

/**
 * Builds the module surface returned by `vi.mock("@tanstack/react-router", ...)`
 * in route-file tests.  Accepts an `api` object whose properties were created
 * via `vi.hoisted(() => ({ ... }))` so that vi.fn refs and the redirect
 * thrower are available before the mock factory runs.  The function itself is
 * imported normally — only the api creation is hoisted.
 *
 * @param api - The router-mock API created via `vi.hoisted(() => ({ ... }))`.
 */
export function buildRouterMockModule(api: RouterMockApi): Record<string, unknown> {
  function attachHooks<TOptions>(options: TOptions) {
    return Object.assign(
      { options },
      {
        useLoaderData: api.useLoaderData,
        useSearch: api.useSearch,
        useParams: api.useParams,
        useRouteContext: api.useRouteContext,
        useRouterState: api.useRouterState,
      },
    );
  }

  return {
    createFileRoute: (_path: string) => (options: unknown) => attachHooks(options),
    createRootRoute: (options: unknown) => attachHooks(options),
    useRouterState: api.useRouterState,
    redirect: api.redirect,
    Outlet: () => <div data-testid="router-outlet" />,
    HeadContent: () => null,
    Scripts: () => null,
    Link: ({ children, to, params, search, className }: MockLinkProps) => (
      <a
        href={to}
        className={className}
        data-link-to={to}
        data-link-params={params ? JSON.stringify(params) : undefined}
        data-link-search={search ? JSON.stringify(search) : undefined}
      >
        {children}
      </a>
    ),
  };
}

/**
 * Helper that throws the same redirect error the production `redirect()` does
 * so tests can assert routing behavior via `expect(...).rejects`.
 *
 * @param options - The redirect options passed to `redirect(...)`.
 */
export function throwRouterRedirect(options: Record<string, unknown>): never {
  const error = new Error("Redirect") as RouterMockRedirectError;
  error.isRedirect = true;
  error.options = options;
  throw error;
}

/**
 * Builds a fresh `RouterMockApi` for use inside `vi.mock("@tanstack/react-router", ...)`.
 * The async factory pattern lets test files import this helper without relying on
 * `vi.hoisted` (which can't reference imports).
 */
export function createRouterMocks(): RouterMockApi {
  return {
    redirect: vi.fn((options: Record<string, unknown>) => {
      throwRouterRedirect(options);
    }),
    useLoaderData: vi.fn(),
    useSearch: vi.fn(),
    useParams: vi.fn(),
    useRouteContext: vi.fn(),
    useRouterState: vi.fn(routerPathnameState("/")),
  };
}

let activeRouterMocks: RouterMockApi | null = null;

function ensureRouterMocks(): RouterMockApi {
  activeRouterMocks ??= createRouterMocks();
  return activeRouterMocks;
}

/**
 * Installs `vi.mock("@tanstack/react-router", ...)` with the harness module
 * factory and returns the live `RouterMockApi` so tests can assert on
 * `redirect` calls and configure hook return values.  Call from a top-level
 * `vi.mock(...)` factory:
 *
 * ```ts
 * vi.mock("@tanstack/react-router", () => installRouterMocks());
 * // ...
 * const router = readRouterMocks();
 * router.useLoaderData.mockReturnValue({ ... });
 * ```
 *
 * Some test files configure router hooks before their route module import
 * triggers Vitest's mock factory. Reusing an existing active mock keeps those
 * early hook values attached to the module surface the route file receives.
 */
export function installRouterMocks(): Record<string, unknown> {
  return buildRouterMockModule(ensureRouterMocks());
}

/**
 * Returns the active `RouterMockApi`, creating it when a test configures
 * router hooks before Vitest has invoked the route mock factory.
 */
export function readRouterMocks(): RouterMockApi {
  return ensureRouterMocks();
}

/**
 * Resets all `vi.fn` recorders on the active router mocks while keeping the
 * `redirect` thrower implementation in place.  Call from `beforeEach` to keep
 * test isolation.
 */
export function resetRouterMocks(): void {
  const routerMocks = ensureRouterMocks();
  routerMocks.useLoaderData.mockReset();
  routerMocks.useSearch.mockReset();
  routerMocks.useParams.mockReset();
  routerMocks.useRouteContext.mockReset();
  routerMocks.useRouterState.mockReset();
  routerMocks.useRouterState.mockImplementation(routerPathnameState("/"));
  routerMocks.redirect.mockClear();
  routerMocks.redirect.mockImplementation((options: Record<string, unknown>) => {
    throwRouterRedirect(options);
  });
}
