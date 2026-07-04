import { createFileRoute } from "@tanstack/react-router";
import { BriefListPage } from "@/domains/workspace/pages/brief-list-page";
import { loadWorkspaceBriefs } from "@/domains/workspace/server/briefs";

export const Route = createFileRoute("/_workspace/briefs")({
  loader: async () => {
    return { briefCollection: await loadWorkspaceBriefs() };
  },
  head: () => ({
    meta: [{ title: "Atlas Briefs | Atlas" }],
  }),
  component: BriefsRoute,
});

function BriefsRoute() {
  const { briefCollection } = Route.useLoaderData();
  return <BriefListPage briefCollection={briefCollection} />;
}
