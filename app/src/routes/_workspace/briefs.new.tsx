import { createFileRoute } from "@tanstack/react-router";
import { BriefCreatePage } from "@/domains/workspace/pages/brief-create-page";

export const Route = createFileRoute("/_workspace/briefs/new")({
  head: () => ({
    meta: [{ title: "New Atlas Brief | Atlas" }],
  }),
  component: BriefNewRoute,
});

function BriefNewRoute() {
  return <BriefCreatePage />;
}
