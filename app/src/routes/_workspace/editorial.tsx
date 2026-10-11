import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireInstanceOperatorSession } from "@/domains/access/server";

/**
 * The instance's editorial tools: claim review, corrections, discovery review
 * and schedules. Only the people who run this instance reach them.
 */
export const Route = createFileRoute("/_workspace/editorial")({
  beforeLoad: ({ location }) => requireInstanceOperatorSession(location.href),
  component: EditorialLayoutRoute,
});

function EditorialLayoutRoute() {
  return <Outlet />;
}
