import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConfirmDialogProvider } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { routeTree } from "./routeTree.gen";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Builds the admin's router. Queries are never cached across operators or
 * refetched in the background: every screen shows what the API says now.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false, staleTime: 0 },
    },
  });

  function Providers({ children }: ProvidersProps) {
    return (
      <QueryClientProvider client={queryClient}>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </QueryClientProvider>
    );
  }

  return createTanStackRouter({
    context: { queryClient },
    defaultPreload: false,
    routeTree,
    scrollRestoration: true,
    Wrap: Providers,
  });
}
