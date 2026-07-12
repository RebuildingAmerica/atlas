import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getAtlasDeployMode } from "@/domains/access/session.functions";
import { PublicTopNav } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";
import { useHydrated } from "@/platform/runtime/use-hydrated";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  const hydrated = useHydrated();
  const deployMode = useQuery({
    enabled: hydrated,
    queryFn: getAtlasDeployMode,
    queryKey: ["atlas", "deploy-mode"],
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
  const localMode = deployMode.data?.localMode ?? false;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const showSearch = pathname !== "/";
  const isMapRoute = pathname === "/map";

  if (isMapRoute) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="sticky top-0 z-30">
          <PublicTopNav localMode={localMode} showSearch={showSearch} />
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="atlas-public-shell relative isolate flex min-h-screen flex-col">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        data-testid="public-global-grid"
      />
      <div className="relative z-10 flex flex-1 flex-col" data-testid="public-sticky-nav-boundary">
        <header className="sticky top-0 z-30">
          <PublicTopNav localMode={localMode} showSearch={showSearch} />
        </header>
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      <div className="relative z-10">
        <PublicFooter localMode={localMode} />
      </div>
    </div>
  );
}
