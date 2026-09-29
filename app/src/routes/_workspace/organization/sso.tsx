import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSSOPage } from "@/domains/access/pages/workspace/organization-sso-page";

export const Route = createFileRoute("/_workspace/organization/sso")({
  head: () => ({ meta: [{ title: "Single sign-on | Atlas" }] }),
  component: OrganizationSSORoute,
});

function OrganizationSSORoute() {
  return <OrganizationSSOPage />;
}
