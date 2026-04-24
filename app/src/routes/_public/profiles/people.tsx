import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/profiles/people")({
  component: PeopleProfilesRoute,
});

function PeopleProfilesRoute() {
  return <Outlet />;
}
