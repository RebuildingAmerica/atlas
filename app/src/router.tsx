import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import type { ReactNode } from "react";
import { ConfirmDialogProvider } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { ToastProvider } from "@rebuildingamerica/atlas-ui/ui/toast";
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
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  const router = createTanStackRouter({
    context: {
      queryClient,
    },
    routeTree,
    scrollRestoration: true,
    Wrap,
  });

  /**
   * Ships the server's React Query cache to the browser.
   *
   * Route loaders warm `context.queryClient` before the server render, so the
   * SSR HTML paints from real data. Without this bridge the browser boots a
   * brand-new, empty QueryClient: every loader-seeded `useQuery` reads
   * `undefined` on its first client render, React reports a hydration mismatch,
   * and the visitor watches populated content blank out and refetch. The
   * integration dehydrates the cache into the SSR stream and hydrates it into
   * this same client before the first render, so what the server painted is
   * what the browser keeps.
   *
   * `wrapQueryClient: false` because {@link Wrap} already mounts the
   * QueryClientProvider — letting the integration add its own would nest a
   * second, redundant provider around the tree.
   */
  setupRouterSsrQueryIntegration({
    queryClient,
    router,
    wrapQueryClient: false,
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
