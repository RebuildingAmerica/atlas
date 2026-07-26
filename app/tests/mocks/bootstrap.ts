import type { DehydratedState } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { vi } from "vitest";

/**
 * Sentinel value masquerading as the generated TanStack route tree so the
 * bootstrap unit tests can assert it is forwarded to `createTanStackRouter`
 * without loading the real `routeTree.gen.ts` (which eagerly imports every
 * route module).
 */
export const ROUTE_TREE_SENTINEL = { __atlasFakeRouteTree: true } as const;

/**
 * Sentinel value returned by the mocked `createRouter` so each entry-point
 * test can assert the same router instance is threaded through to the
 * downstream hydration / SSR helpers.
 */
export const ROUTER_SENTINEL = { __atlasRouter: true } as const;

/**
 * Sentinel value returned by the mocked `createStartHandler` so the
 * `entry.server` test can assert the module's default export forwards the
 * handler verbatim.
 */
export const START_HANDLER_SENTINEL = { __atlasHandler: true } as const;

/**
 * Router-level dehydrated payload the React Query SSR integration installs a
 * `hydrate` handler for: the server's cache snapshot plus the stream carrying
 * queries that only settled after the shell was flushed.
 */
export interface DehydratedRouterPayload {
  dehydratedQueryClient?: DehydratedState;
  queryStream: ReadableStream<DehydratedState>;
}

/**
 * Captured options forwarded to the mocked `createTanStackRouter` call.
 *
 * Tests use this shape to assert the router options that `getRouter`
 * supplies (route tree, scroll restoration flag, and the `Wrap` provider
 * component) without instantiating the real router. `hydrate` is absent until
 * the SSR query integration installs it.
 */
export interface CapturedRouterOptions {
  context?: {
    queryClient?: unknown;
  };
  hydrate?: (dehydrated: DehydratedRouterPayload) => Promise<void>;
  routeTree: unknown;
  scrollRestoration: boolean;
  Wrap: (props: { children: ReactNode }) => ReactNode;
}

/**
 * Container for the router-mock state that each test resets in `beforeEach`.
 * Holding the captured options on the same record as the spy keeps the
 * `vi.mock` factories closed over a single object reference.
 */
export interface RouterMockState {
  createRouter: ReturnType<typeof vi.fn>;
  lastOptions: CapturedRouterOptions | null;
}

/**
 * Container for the `entry.client` mock state.  Test files build the
 * concrete shape inside `vi.hoisted` (so the factories close over
 * `vi.fn()` references at hoist time) and use this interface to keep the
 * resulting object typed.
 */
export interface ClientEntryMockState {
  createRouter: ReturnType<typeof vi.fn>;
  hydrateRoot: ReturnType<typeof vi.fn>;
  startClient: ReturnType<typeof vi.fn>;
}

/**
 * Shape of the React element forwarded to `hydrateRoot` by `entry.client`.
 *
 * The element wraps the mocked `StartClient`, so the test inspects its
 * `type` (the component reference) and `props.router` (the router instance
 * the client entry threaded through).
 */
export interface StartClientElement {
  type: unknown;
  props: { router: unknown };
}

/**
 * Container for the `entry.server` mock state.
 */
export interface ServerEntryMockState {
  createRouter: ReturnType<typeof vi.fn>;
  createStartHandler: ReturnType<typeof vi.fn>;
}
