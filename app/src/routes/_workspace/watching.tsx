import { createFileRoute } from "@tanstack/react-router";
import { workspaceWatchesQueryOptions } from "@/domains/workspace/hooks/use-workspace-watches";
import { WorkspaceWatchesPage } from "@/domains/workspace/pages/watches-page";

export const Route = createFileRoute("/_workspace/watching")({
  loader: ({ context }) => {
    return context.queryClient.ensureQueryData(workspaceWatchesQueryOptions());
  },
  head: () => ({
    meta: [{ title: "Watching | Atlas" }],
  }),
  component: WatchingRoute,
});

function WatchingRoute() {
  return <WorkspaceWatchesPage />;
}
