import { createFileRoute } from "@tanstack/react-router";
import { researchSummaryQueryOptions } from "@/domains/workspace/hooks/use-research-summary";
import { ResearchHomePage } from "@/domains/workspace/pages/research-home-page";

export const Route = createFileRoute("/_workspace/home")({
  loader: ({ context }) => {
    return context.queryClient.ensureQueryData(researchSummaryQueryOptions());
  },
  head: () => ({
    meta: [{ title: "My Research | Atlas" }],
  }),
  component: HomeRoute,
});

function HomeRoute() {
  return <ResearchHomePage />;
}
