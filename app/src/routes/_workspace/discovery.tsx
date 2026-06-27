import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "@/domains/discovery";
import { listDiscoveryRuns } from "@/domains/discovery/functions";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_workspace/discovery")({
  loader: async () => {
    const [initialRuns, initialTaxonomy] = await Promise.all([
      listDiscoveryRuns(),
      api.taxonomy.list(),
    ]);
    return { initialRuns, initialTaxonomy };
  },
  head: () => ({
    meta: [
      { title: "Research | Atlas" },
      {
        name: "description",
        content: "Start source-linked local civic research and export reusable briefs.",
      },
    ],
  }),
  component: DiscoveryRoute,
});

function DiscoveryRoute() {
  const { initialRuns, initialTaxonomy } = Route.useLoaderData();
  return <DiscoveryPage initialRuns={initialRuns} initialTaxonomy={initialTaxonomy} />;
}
