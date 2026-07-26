import { createFileRoute } from "@tanstack/react-router";
import { warmRouteQueries } from "@/platform/runtime/route-queries";
import { workspaceCoverageQueryOptions } from "@/domains/workspace/hooks/use-coverage-targets";
import { CoveragePage } from "@/domains/workspace/pages/coverage-page";

export const Route = createFileRoute("/_workspace/coverage")({
  loader: ({ context }) =>
    warmRouteQueries(context.queryClient.ensureQueryData(workspaceCoverageQueryOptions())),
  head: () => ({
    meta: [{ title: "Coverage Workspace | Atlas" }],
  }),
  component: CoverageRoute,
});

function CoverageRoute() {
  return <CoveragePage />;
}
