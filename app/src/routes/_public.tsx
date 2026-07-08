import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { getAtlasDeployMode } from "@/domains/access/session.functions";
import { PublicTopNav } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";

export const Route = createFileRoute("/_public")({
  loader: async (): Promise<{ localMode: boolean }> => {
    const { localMode } = await getAtlasDeployMode();
    return { localMode };
  },
  staleTime: 1000 * 60 * 5,
  component: PublicLayout,
});

function PublicLayout() {
  const { localMode } = Route.useLoaderData();
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
    <div
      className="bg-surface relative isolate flex min-h-screen flex-col"
      style={{
        backgroundImage:
          "linear-gradient(rgba(28, 31, 43, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(28, 31, 43, 0.045) 1px, transparent 1px)",
        backgroundPosition: "max(0px, calc((100vw - 88rem) / 2)) 0",
        backgroundSize: "32px 32px",
      }}
    >
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
