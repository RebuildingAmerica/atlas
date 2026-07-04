import { createFileRoute } from "@tanstack/react-router";
import { CoverageDetailPage } from "@/domains/workspace/pages/coverage-detail-page";
import { loadWorkspaceCoverageTargetDetail } from "@/domains/workspace/server/coverage-targets";

export const Route = createFileRoute("/_workspace/coverage/$targetId")({
  loader: async ({ params }) => {
    return {
      coverageTargetDetail: await loadWorkspaceCoverageTargetDetail({
        data: { targetId: params.targetId },
      }),
    };
  },
  head: () => ({
    meta: [{ title: "Coverage Target | Atlas" }],
  }),
  component: CoverageTargetRoute,
});

function CoverageTargetRoute() {
  const { coverageTargetDetail } = Route.useLoaderData();
  return <CoverageDetailPage detail={coverageTargetDetail} />;
}
