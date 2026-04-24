import { Outlet, createFileRoute } from "@tanstack/react-router";
import { getStatus, type Status } from "@openstatus/react";
import { PublicTopNav } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";

export const Route = createFileRoute("/_public")({
  loader: async (): Promise<{ status: Status }> => {
    try {
      const { status } = await getStatus("atlasapp");
      return { status };
    } catch {
      return { status: "unknown" };
    }
  },
  staleTime: 1000 * 60 * 5,
  component: PublicLayout,
});

function PublicLayout() {
  const { status } = Route.useLoaderData();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30">
        <PublicTopNav />
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <PublicFooter status={status} />
    </div>
  );
}
