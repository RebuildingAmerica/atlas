import { createFileRoute } from "@tanstack/react-router";
import { CoverageDetailPage } from "@/domains/workspace/pages/coverage-detail-page";
import { loadWorkspaceCoverageTargetDetail } from "@/domains/workspace/server/coverage-targets";
import { loadWorkspaceFirehoseSourceTargets } from "@/domains/workspace/server/firehose";

export const Route = createFileRoute("/_workspace/coverage/$targetId")({
  loader: async ({ params }) => {
    const [coverageTargetDetail, sourceTargets] = await Promise.all([
      loadWorkspaceCoverageTargetDetail({
        data: { targetId: params.targetId },
      }),
      loadWorkspaceFirehoseSourceTargets({
        data: { coverageTargetId: params.targetId },
      }),
    ]);
    return {
      coverageTargetDetail,
      sourceTargets,
    };
  },
  head: () => ({
    meta: [{ title: "Coverage Target | Atlas" }],
  }),
  component: CoverageTargetRoute,
});

function CoverageTargetRoute() {
  const { coverageTargetDetail, sourceTargets } = Route.useLoaderData();
  return <CoverageDetailPage detail={coverageTargetDetail} sourceTargets={sourceTargets} />;
}
