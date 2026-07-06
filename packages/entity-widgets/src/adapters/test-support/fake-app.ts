import { vi } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Shape of the one argument `App#callServerTool` takes. */
export interface CallServerToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * `App#callServerTool`'s real signature, narrowed to a plain call signature
 * (no construct signature). `vi.fn()`'s default generic (`Procedure =
 * (...args: any[]) => any`) is structurally assignable to a construct
 * signature too, purely because of `any` — which makes `mockImplementation`
 * accept a false three-way union including a void-returning overload, and
 * `@typescript-eslint/no-misused-promises` then (correctly, given that
 * inferred type) flags a Promise-returning implementation as a misuse. This
 * explicit, non-`any` signature keeps the mock's inferred type unambiguous.
 */
export type FakeCallServerTool = (
  params: CallServerToolParams,
) => Promise<CallToolResult>;

/**
 * Minimal stand-in for the real `App` instance `useApp` would create. Models
 * the members every widget hook in this package touches via
 * `useWidgetToolConnection`/`usePaginatedWidgetData`:
 * `ontoolresult`/`onerror`/`getHostContext` (every widget), plus
 * `ontoolinput`/`callServerTool` (pagination — `useSearchResultsData` and
 * `useConnectionsData` only).
 *
 * Shared by `entity-card-data.test.ts`, `search-results-data.test.ts`, and
 * `connections-data.test.ts` so the three don't each hand-roll their own
 * copy of this fixture and quietly drift apart on what they're mocking.
 */
export interface FakeApp {
  ontoolinput?: (params: { arguments?: Record<string, unknown> }) => void;
  ontoolresult?: (result: CallToolResult) => void;
  onerror?: (error: Error) => void;
  getHostContext: ReturnType<typeof vi.fn>;
  callServerTool: ReturnType<typeof vi.fn<FakeCallServerTool>>;
}

export function createFakeApp(): FakeApp {
  return {
    getHostContext: vi.fn().mockReturnValue(undefined),
    callServerTool: vi.fn<FakeCallServerTool>(),
  };
}

/**
 * Wires a mocked `useApp` (from `@modelcontextprotocol/ext-apps/react`) to
 * invoke `onAppCreated` with `fakeApp` and report a successful connection —
 * the "happy path" every test starts from before overriding `useApp`'s
 * return value for a specific connect-error scenario.
 */
export function mockSuccessfulConnection(
  useApp: ReturnType<typeof vi.fn>,
  fakeApp: FakeApp,
): void {
  useApp.mockImplementation(
    ({ onAppCreated }: { onAppCreated?: (app: FakeApp) => void }) => {
      onAppCreated?.(fakeApp);
      return { app: fakeApp as unknown as App, isConnected: true, error: null };
    },
  );
}
