import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";
import { useOrganizationPageController } from "@/domains/access/components/organization/organization-page-controller";
import { OrganizationSSOPageView } from "@/domains/access/components/organization/organization-sso-page-view";

/**
 * Props accepted by the focused enterprise SSO page.
 */
export interface OrganizationSSOPageProps {
  initialOrganization?: AtlasOrganizationDetails | null;
}

/**
 * Thin route-level page for enterprise sign-in configuration.
 */
export function OrganizationSSOPage({ initialOrganization = null }: OrganizationSSOPageProps) {
  const controller = useOrganizationPageController({
    initialOrganization,
  });

  return <OrganizationSSOPageView controller={controller} />;
}
