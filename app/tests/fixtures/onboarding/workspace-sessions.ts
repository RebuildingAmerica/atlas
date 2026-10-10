import type { AtlasWorkspaceMembership } from "@rebuildingamerica/atlas-access";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../access/sessions";

export const personal: AtlasWorkspaceMembership = {
  id: "org_personal",
  name: "My Workspace",
  slug: "my-workspace",
  role: "owner",
  workspaceType: "individual",
};
export const team: AtlasWorkspaceMembership = {
  id: "org_team",
  name: "Transit Coalition",
  slug: "transit-coalition",
  role: "admin",
  workspaceType: "team",
};
export function createWorkspaceSession(
  memberships: AtlasWorkspaceMembership[],
  activeOrganization = memberships[0] ?? null,
) {
  return {
    data: createAtlasSessionFixture({
      workspace: createAtlasWorkspace({ memberships, activeOrganization }),
    }),
  };
}
