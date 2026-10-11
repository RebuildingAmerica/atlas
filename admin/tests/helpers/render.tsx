import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { ConfirmDialogProvider } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { getRouter } from "@/router";

interface ProvidersProps {
  children: ReactNode;
}

type AdminRouter = ReturnType<typeof getRouter>;

export interface RenderedRoute {
  html: string;
  router: AdminRouter;
}

/** Renders a screen inside a fresh query client that never retries. */
export function renderWithQueries(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Providers({ children }: ProvidersProps) {
    return (
      <QueryClientProvider client={client}>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Providers });
}

/** Server-renders the whole admin at a path, as the Worker would. */
export async function renderRoute(
  path: "/" | "/discounts" | "/cloud-costs" | "/switches" | "/accounts",
): Promise<RenderedRoute> {
  const router = getRouter();
  router.update({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return { html: renderToString(<RouterProvider router={router} />), router };
}

/** Returns the page title the matched routes set, innermost first. */
export function pageTitle(router: AdminRouter): string | undefined {
  const metas = router.state.matches.flatMap((match) => match.meta ?? []);
  return metas.reverse().find((meta) => meta && "title" in meta)?.title;
}

/** Returns every meta tag the matched routes set. */
export function pageMeta(router: AdminRouter) {
  return router.state.matches.flatMap((match) => match.meta ?? []);
}
