import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { ConfirmDialogProvider } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { ToastProvider } from "@rebuildingamerica/atlas-ui/ui/toast";

export interface RenderWithProvidersOptions {
  /** Seed the cache before the first render, as a route loader would. */
  seed?: (queryClient: QueryClient) => void;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

/**
 * Builds the client the app's tests want: retries off so a rejected query
 * surfaces immediately instead of after three attempts, and no cache carried
 * between tests.
 *
 * @returns A QueryClient configured for assertions rather than resilience.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: 0, retry: false, staleTime: 0 },
    },
  });
}

/**
 * Renders a subject inside the providers the real app mounts around it.
 *
 * Components that call `useQuery`, `useToast` or `useConfirmDialog` throw
 * without these, which is why so many suites reached for `vi.mock` on the
 * whole of react-query instead -- and then asserted against their own stub
 * rather than the component. This renders the real thing.
 *
 * @param ui - The element under test.
 * @param options - Optional cache seeding.
 * @returns The Testing Library result, plus the client so a test can assert on
 *   or invalidate cache state.
 */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const queryClient = createTestQueryClient();
  options.seed?.(queryClient);

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmDialogProvider>{ui}</ConfirmDialogProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );

  return Object.assign(result, { queryClient });
}
