import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPage } from "@/domains/access/pages/workspace/organization-page";

export const Route = createFileRoute("/_workspace/organization/")({
  head: () => ({ meta: [{ title: "Workspace | Atlas" }] }),
  component: OrganizationIndexRoute,
});

function OrganizationIndexRoute() {
  return <OrganizationPage />;
}
