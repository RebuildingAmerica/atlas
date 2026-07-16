import { describe, expect, it } from "vitest";
import {
  buildAtlasWorkspaceCapabilities,
  mergeAtlasOrganizationMetadata,
  normalizeAtlasOrganizationMetadata,
} from "./organization-metadata";

describe("organization-metadata", () => {
  describe("normalizeAtlasOrganizationMetadata", () => {
    it("parses valid metadata objects", () => {
      expect(
        normalizeAtlasOrganizationMetadata({
          workspaceType: "team",
          ssoPrimaryProviderId: "google",
        }),
      ).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: "google",
        stripeCustomerId: null,
      });
    });

    it("parses JSON strings", () => {
      expect(
        normalizeAtlasOrganizationMetadata(
          JSON.stringify({ workspaceType: "team", ssoPrimaryProviderId: "google" }),
        ),
      ).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: "google",
        stripeCustomerId: null,
      });
    });

    it("falls back to individual workspace type for invalid or missing inputs", () => {
      expect(normalizeAtlasOrganizationMetadata({})).toEqual({
        workspaceType: "individual",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
      expect(normalizeAtlasOrganizationMetadata(null)).toEqual({
        workspaceType: "individual",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
      expect(normalizeAtlasOrganizationMetadata("{invalid json")).toEqual({
        workspaceType: "individual",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
    });

    it("normalizes stripeCustomerId", () => {
      expect(
        normalizeAtlasOrganizationMetadata({
          workspaceType: "team",
          ssoPrimaryProviderId: null,
          stripeCustomerId: "cus_abc123",
        }),
      ).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: null,
        stripeCustomerId: "cus_abc123",
      });
    });

    it("defaults stripeCustomerId to null", () => {
      expect(normalizeAtlasOrganizationMetadata({})).toEqual({
        workspaceType: "individual",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
    });
  });

  describe("mergeAtlasOrganizationMetadata", () => {
    it("merges updates into existing metadata", () => {
      const original = { workspaceType: "individual", ssoPrimaryProviderId: null };
      const updates = { workspaceType: "team" as const };
      expect(mergeAtlasOrganizationMetadata(original, updates)).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
    });

    it("allows clearing primary provider", () => {
      const original = { workspaceType: "team", ssoPrimaryProviderId: "google" };
      const updates = { ssoPrimaryProviderId: null };
      expect(mergeAtlasOrganizationMetadata(original, updates)).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
    });

    it("preserves stripeCustomerId across merges", () => {
      const original = {
        workspaceType: "team" as const,
        ssoPrimaryProviderId: null,
        stripeCustomerId: "cus_abc123",
      };
      const updates = { ssoPrimaryProviderId: "google" };
      expect(mergeAtlasOrganizationMetadata(original, updates)).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: "google",
        stripeCustomerId: "cus_abc123",
      });
    });
  });

  describe("buildAtlasWorkspaceCapabilities", () => {
    it("grants management capabilities to owners of team workspaces", () => {
      expect(buildAtlasWorkspaceCapabilities("team", "owner", 1)).toEqual({
        canInviteMembers: true,
        canManageOrganization: true,
        canSwitchOrganizations: false,
        canUseTeamFeatures: true,
      });
    });

    it("denies management capabilities to members of team workspaces", () => {
      expect(buildAtlasWorkspaceCapabilities("team", "member", 1)).toEqual({
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: true,
      });
    });

    it("denies team features to individual workspaces", () => {
      expect(buildAtlasWorkspaceCapabilities("individual", "owner", 1)).toEqual({
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: false,
      });
    });

    it("enables switching when there are multiple memberships", () => {
      expect(buildAtlasWorkspaceCapabilities("individual", "owner", 2).canSwitchOrganizations).toBe(
        true,
      );
    });

    it("handles null workspace type", () => {
      expect(buildAtlasWorkspaceCapabilities(null, "owner", 1).canUseTeamFeatures).toBe(false);
    });
  });

  describe("extra normalization branches", () => {
    it("handles partial success in normalize", () => {
      // workspaceType matches but ssoPrimaryProviderId is missing
      expect(normalizeAtlasOrganizationMetadata({ workspaceType: "team" })).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: null,
        stripeCustomerId: null,
      });
    });

    it("handles missing workspaceType update in merge", () => {
      const original = { workspaceType: "team" as const, ssoPrimaryProviderId: "google" };
      expect(mergeAtlasOrganizationMetadata(original, { ssoPrimaryProviderId: "new" })).toEqual({
        workspaceType: "team",
        ssoPrimaryProviderId: "new",
        stripeCustomerId: null,
      });
    });

    it("preserves workspaceDomain and ssoPrimaryHistory when present", () => {
      const result = normalizeAtlasOrganizationMetadata({
        workspaceType: "team",
        workspaceDomain: "acme.example",
        ssoPrimaryHistory: [
          {
            changedAt: "2024-01-01T00:00:00.000Z",
            changedByEmail: "owner@acme.example",
            providerId: "okta",
          },
        ],
      });
      expect(result.workspaceDomain).toBe("acme.example");
      expect(result.ssoPrimaryHistory).toEqual([
        {
          changedAt: "2024-01-01T00:00:00.000Z",
          changedByEmail: "owner@acme.example",
          providerId: "okta",
        },
      ]);
    });

    it("merges an explicit stripeCustomerId update", () => {
      const original = {
        workspaceType: "team" as const,
        stripeCustomerId: "cus_old",
      };
      expect(
        mergeAtlasOrganizationMetadata(original, { stripeCustomerId: "cus_new" }),
      ).toMatchObject({ stripeCustomerId: "cus_new" });
    });

    it("clears stripeCustomerId when an update sets it to null", () => {
      const original = {
        workspaceType: "team" as const,
        stripeCustomerId: "cus_abc",
      };
      expect(mergeAtlasOrganizationMetadata(original, { stripeCustomerId: null })).toMatchObject({
        stripeCustomerId: null,
      });
    });

    it("treats undefined membership role as a non-manager", () => {
      const capabilities = buildAtlasWorkspaceCapabilities("team", undefined, 1);
      expect(capabilities.canManageOrganization).toBe(false);
      expect(capabilities.canInviteMembers).toBe(false);
    });
  });
});
