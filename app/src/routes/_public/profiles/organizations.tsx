import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/profiles/organizations")({
  component: OrganizationProfilesRoute,
});

function OrganizationProfilesRoute() {
  return <Outlet />;
}
