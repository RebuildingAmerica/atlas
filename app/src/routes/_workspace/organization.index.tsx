import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPage } from "@/domains/access/pages/workspace/organization-page";
import { getOrganizationDetails } from "@/domains/access/organizations.functions";

export const Route = createFileRoute("/_workspace/organization/")({
  beforeLoad: async () => {
    const initialOrganizationPromise = getOrganizationDetails();
    const initialOrganization = await initialOrganizationPromise;

    return {
      initialOrganization,
    };
  },
  component: OrganizationIndexRoute,
});

function OrganizationIndexRoute() {
  const { initialOrganization } = Route.useRouteContext();

  return <OrganizationPage initialOrganization={initialOrganization} />;
}
