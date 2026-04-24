import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSSOPage } from "@/domains/access/pages/workspace/organization-sso-page";
import { getOrganizationDetails } from "@/domains/access/organizations.functions";

export const Route = createFileRoute("/_workspace/organization/sso")({
  beforeLoad: async () => {
    const initialOrganization = await getOrganizationDetails();

    return {
      initialOrganization,
    };
  },
  component: OrganizationSSORoute,
});

function OrganizationSSORoute() {
  const { initialOrganization } = Route.useRouteContext();

  return <OrganizationSSOPage initialOrganization={initialOrganization} />;
}
