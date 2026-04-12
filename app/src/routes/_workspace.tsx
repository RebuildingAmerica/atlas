import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireReadyAtlasSession } from "@/domains/access/server";
import { WorkspaceLayout } from "@/platform/layout/workspace-layout";

export const Route = createFileRoute("/_workspace")({
  beforeLoad: async ({ location }) => {
    return {
      session: await requireReadyAtlasSession(location.href),
    };
  },
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  return (
    <WorkspaceLayout>
      <Outlet />
    </WorkspaceLayout>
  );
}
