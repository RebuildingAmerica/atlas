import { createFileRoute } from "@tanstack/react-router";
import { CoveragePage } from "@/domains/workspace/pages/coverage-page";
import { loadWorkspaceCoverage } from "@/domains/workspace/server/coverage-targets";

export const Route = createFileRoute("/_workspace/coverage")({
  loader: async () => {
    return { coverageWorkspace: await loadWorkspaceCoverage() };
  },
  head: () => ({
    meta: [{ title: "Coverage Workspace | Atlas" }],
  }),
  component: CoverageRoute,
});

function CoverageRoute() {
  const { coverageWorkspace } = Route.useLoaderData();
  return (
    <CoveragePage
      initialCoverageTargets={coverageWorkspace.coverageTargets}
      orgId={coverageWorkspace.orgId}
    />
  );
}
