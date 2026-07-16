import type { AtlasOrganizationDetails } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import { useOrganizationPageController } from "@/domains/access/components/organization/organization-page-controller";
import { OrganizationWorkspacePageView } from "@/domains/access/components/organization/organization-workspace-page-view";

/**
 * Props accepted by the main organization-management page.
 */
export interface OrganizationPageProps {
  initialOrganization?: AtlasOrganizationDetails | null;
}

/**
 * Thin route-level page for workspace management.
 */
export function OrganizationPage({ initialOrganization }: OrganizationPageProps) {
  const controller = useOrganizationPageController({
    initialOrganization,
  });

  return <OrganizationWorkspacePageView controller={controller} />;
}
