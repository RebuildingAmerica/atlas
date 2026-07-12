import { Outlet, createFileRoute } from "@tanstack/react-router";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_onboarding/onboarding")({
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: SetupRoute,
});

function SetupRoute() {
  return <Outlet />;
}
