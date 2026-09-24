import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BriefCreatePage } from "@/domains/workspace/pages/brief-create-page";

export const Route = createFileRoute("/_workspace/briefs/new")({
  validateSearch: z.object({ list: z.string().optional() }),
  head: () => ({
    meta: [{ title: "New Atlas Brief | Atlas" }],
  }),
  component: BriefNewRoute,
});

function BriefNewRoute() {
  const { list } = Route.useSearch();
  return <BriefCreatePage initialListId={list} />;
}
