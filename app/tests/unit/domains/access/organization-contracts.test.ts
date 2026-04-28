import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  toAtlasOrganizationDetails,
  toIsoString,
  type organizationDetailsSchema,
} from "@/domains/access/organization-contracts";
import type { AtlasWorkspaceSSOState } from "@/domains/access/organization-sso";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";

describe("organization-contracts", () => {
  type OrganizationDetails = z.infer<typeof organizationDetailsSchema>;

  describe("toIsoString", () => {
    it("returns string as is", () => {
      expect(toIsoString("2026-01-01")).toBe("2026-01-01");
    });

    it("returns ISO string from Date object", () => {
      const date = new Date("2026-04-20T12:00:00.000Z");
      expect(toIsoString(date)).toBe("2026-04-20T12:00:00.000Z");
    });
  });

  describe("toAtlasOrganizationDetails", () => {
    const session = createAtlasSessionFixture({
      role: "admin",
      workspace: createAtlasWorkspace({
        activeOrganization: {
          id: "org_1",
          name: "Org 1",
          role: "admin",
          slug: "org-1",
          workspaceType: "team",
        },
        memberships: [
          { id: "org_1", name: "Org 1", role: "admin", slug: "org-1", workspaceType: "team" },
        ],
        capabilities: {
          canManageOrganization: true,
          canInviteMembers: true,
          canSwitchOrganizations: false,
          canUseTeamFeatures: true,
        },
        onboarding: { hasPendingInvitations: false, needsWorkspace: false },
      }),
    });

    const ssoState: AtlasWorkspaceSSOState = {
      primaryHistory: [],
      primaryProviderId: null,
      providers: [],
      setup: {
        dnsTokenPrefix: "",
        googleWorkspaceIssuer: "",
        googleWorkspaceScopes: [],
        oidcProviderIdSuggestion: "",
        oidcRedirectUrl: "",
        samlAcsUrl: "",
        samlEntityId: "",
        samlMetadataUrl: "",
        samlProviderIdSuggestion: "",
        workspaceDomainSuggestion: "test",
      },
    };

    it("returns null when details are missing", () => {
      expect(toAtlasOrganizationDetails(null, session, ssoState)).toBeNull();
    });

    it("normalizes full organization details", () => {
      const details: OrganizationDetails = {
        id: "org_1",
        name: "Org 1",
        slug: "org-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { workspaceType: "team" },
        invitations: [
          {
            id: "inv_1",
            email: "invited@test.com",
            role: "member",
            status: "pending",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: new Date("2026-02-01T00:00:00.000Z"),
          },
        ],
        members: [
          {
            id: "mem_1",
            organizationId: "org_1",
            role: "admin",
            userId: "user_123",
            createdAt: "2026-01-01T00:00:00.000Z",
            user: {
              id: "user_123",
              email: "operator@atlas.test",
              name: "Operator",
              image: "img_url",
            },
          },
        ],
      };

      const result = toAtlasOrganizationDetails(details, session, ssoState);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.id).toBe("org_1");
      expect(result.role).toBe("admin");
      expect(result.members).toHaveLength(1);
      expect(result.members[0]?.image).toBe("img_url");
      expect(result.invitations).toHaveLength(1);
      expect(result.invitations[0]?.status).toBe("pending");
    });

    it("defaults to member role when membership is not found", () => {
      const details: OrganizationDetails = {
        id: "org_unknown",
        name: "Unknown",
        slug: "unknown",
        createdAt: new Date(),
        invitations: [],
        members: [],
      };
      const result = toAtlasOrganizationDetails(details, session, ssoState);
      expect(result?.role).toBe("member");
    });

    it("handles missing user images", () => {
      const details: OrganizationDetails = {
        id: "org_1",
        name: "Org 1",
        slug: "org-1",
        createdAt: new Date(),
        invitations: [],
        members: [
          {
            id: "mem_1",
            organizationId: "org_1",
            role: "owner",
            userId: "u1",
            createdAt: new Date(),
            user: { id: "u1", email: "a@b.com", name: "A", image: null },
          },
        ],
      };
      const result = toAtlasOrganizationDetails(details, session, ssoState);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.members).toHaveLength(1);
      expect(result.members[0]?.image).toBeNull();
    });
  });
});
