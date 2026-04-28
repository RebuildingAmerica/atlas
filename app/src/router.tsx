import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { routeTree } from "./routeTree.gen";

/**
 * Builds the React Query client used everywhere in Atlas.
 *
 * Centralised here so the router-level `Wrap` provider, the SSR shell, and
 * any test harness all share the exact same defaults.
 */
function createAtlasQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 1000 * 60 * 30,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 1000 * 60 * 5,
      },
    },
  });
}

export function getRouter() {
  const queryClient = createAtlasQueryClient();

  /**
   * Wraps the entire router output — matched routes, error boundaries, and
   * the not-found component — in the QueryClientProvider. Putting the
   * provider in `__root.tsx`'s `component` instead would leave the error and
   * not-found surfaces outside the React Query context, which crashes any
   * `useQuery` they (or anything they render, like the public nav) call.
   */
  function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    Wrap,
  });

  return router;
}

export function createRouter() {
  return getRouter();
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
