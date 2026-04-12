import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  return <Outlet />;
}
