import { Outlet, createFileRoute } from "@tanstack/react-router";
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
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30">
        <PublicTopNav localMode={localMode} />
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <PublicFooter localMode={localMode} />
    </div>
  );
}
