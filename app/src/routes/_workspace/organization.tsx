import { Outlet, createFileRoute } from "@tanstack/react-router";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_workspace/organization")({
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: OrganizationLayoutRoute,
});

function OrganizationLayoutRoute() {
  return <Outlet />;
}
