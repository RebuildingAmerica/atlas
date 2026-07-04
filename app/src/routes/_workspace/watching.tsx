import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceWatchesPage } from "@/domains/workspace/pages/watches-page";
import { loadWorkspaceWatches } from "@/domains/workspace/server/watches";

export const Route = createFileRoute("/_workspace/watching")({
  loader: async () => {
    return { workspaceWatches: await loadWorkspaceWatches() };
  },
  head: () => ({
    meta: [{ title: "Watching | Atlas" }],
  }),
  component: WatchingRoute,
});

function WatchingRoute() {
  const { workspaceWatches } = Route.useLoaderData();
  return <WorkspaceWatchesPage initialWatches={workspaceWatches} />;
}
