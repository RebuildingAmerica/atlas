import { createFileRoute } from "@tanstack/react-router";
import { ResearchHomePage } from "@/domains/workspace/pages/research-home-page";
import { loadResearchSummary } from "@/domains/workspace/server/research-summary";

export const Route = createFileRoute("/_workspace/home")({
  loader: async () => {
    const summary = await loadResearchSummary();
    return { summary };
  },
  head: () => ({
    meta: [{ title: "My Research | Atlas" }],
  }),
  component: HomeRoute,
});

function HomeRoute() {
  const { summary } = Route.useLoaderData();
  return <ResearchHomePage initialSummary={summary} />;
}
