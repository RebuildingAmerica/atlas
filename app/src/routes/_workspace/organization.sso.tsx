import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSSOPage } from "@/domains/access/pages/workspace/organization-sso-page";

export const Route = createFileRoute("/_workspace/organization/sso")({
  component: OrganizationSSORoute,
});

function OrganizationSSORoute() {
  return <OrganizationSSOPage />;
}
