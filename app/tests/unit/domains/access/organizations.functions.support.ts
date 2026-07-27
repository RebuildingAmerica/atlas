import {
  resolveCapabilities,
  serializeResolvedCapabilities,
} from "@rebuildingamerica/atlas-access/workspace/capabilities";
import {
  createAtlasResolvedCapabilities,
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../fixtures/access/sessions";

export const browserSessionHeaders = new Headers({ cookie: "test" });

export function subscribedTeamSession(maxMembers: number | null) {
  // Capabilities are derived from the products rather than listed by hand, so
  // the fixture cannot claim a subscription whose capabilities it lacks. That
  // inconsistency was invisible while the gate checked product identifiers.
  return createAtlasSessionFixture({
    workspace: createAtlasWorkspace({
      activeProducts: ["atlas_team"],
      resolvedCapabilities: createAtlasResolvedCapabilities(
        { max_members: maxMembers },
        serializeResolvedCapabilities(resolveCapabilities(["atlas_team"])).capabilities,
      ),
    }),
  });
}

export function individualWorkspaceSession(role: string) {
  return createAtlasSessionFixture({
    workspace: createAtlasWorkspace({
      activeOrganization: {
        id: "org_solo",
        name: "Solo Workspace",
        role,
        slug: "solo-workspace",
        workspaceType: "individual",
      },
    }),
  });
}

export function fullOrganizationFixture(memberCount: number, invitationStatuses: string[]) {
  return {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: "org_team",
    metadata: { workspaceType: "team" },
    name: "Atlas Team",
    slug: "atlas-team",
    members: Array.from({ length: memberCount }, (_, index) => ({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: `mem_${index}`,
      organizationId: "org_team",
      role: "member",
      user: { email: `member${index}@atlas.test`, id: `user_${index}`, name: `Member ${index}` },
      userId: `user_${index}`,
    })),
    invitations: invitationStatuses.map((status, index) => ({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      email: `invite${index}@atlas.test`,
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      id: `pending_${index}`,
      role: "member",
      status,
    })),
  };
}
