import { createFileRoute } from "@tanstack/react-router";
import { warmRouteQueries } from "@/platform/runtime/route-queries";
import { workspaceBriefsQueryOptions } from "@/domains/workspace/hooks/use-briefs";
import { BriefListPage } from "@/domains/workspace/pages/brief-list-page";

export const Route = createFileRoute("/_workspace/briefs")({
  loader: ({ context }) =>
    warmRouteQueries(context.queryClient.ensureQueryData(workspaceBriefsQueryOptions())),
  head: () => ({
    meta: [{ title: "Atlas Briefs | Atlas" }],
  }),
  component: BriefsRoute,
});

function BriefsRoute() {
  return <BriefListPage />;
}
