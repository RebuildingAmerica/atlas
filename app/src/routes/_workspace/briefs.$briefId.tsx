import { createFileRoute } from "@tanstack/react-router";
import { BriefDetailPage } from "@/domains/workspace/pages/brief-detail-page";
import { loadWorkspaceBriefExport } from "@/domains/workspace/server/briefs";

export const Route = createFileRoute("/_workspace/briefs/$briefId")({
  loader: async ({ params }) => {
    return {
      briefExport: await loadWorkspaceBriefExport({ data: { briefId: params.briefId } }),
    };
  },
  head: () => ({
    meta: [{ title: "Atlas Brief | Atlas" }],
  }),
  component: BriefRoute,
});

function BriefRoute() {
  const { briefExport } = Route.useLoaderData();
  return <BriefDetailPage briefExport={briefExport} />;
}
