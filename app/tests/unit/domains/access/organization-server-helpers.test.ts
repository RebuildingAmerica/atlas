import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";
import {
  assertOrganizationManagementEnabled,
  requireActiveWorkspace,
  requireManagedTeamWorkspace,
} from "@/domains/access/organization-server-helpers";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
  canManageAtlasOrganizationRole: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/organization-metadata", () => ({
  canManageAtlasOrganizationRole: mocks.canManageAtlasOrganizationRole,
}));

describe("organization-server-helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.canManageAtlasOrganizationRole.mockReset();
  });

  describe("assertOrganizationManagementEnabled", () => {
    it("throws in local mode", () => {
      mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: true });
      expect(() => {
        assertOrganizationManagementEnabled();
      }).toThrow("Organization management is unavailable while auth is disabled.");
    });

    it("does not throw when local mode is false", () => {
      mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false });
      expect(() => {
        assertOrganizationManagementEnabled();
      }).not.toThrow();
    });
  });

  describe("requireActiveWorkspace", () => {
    it("returns the active organization when present", () => {
      const session = {
        workspace: { activeOrganization: { id: "org_123" } },
      } as unknown as AtlasSessionPayload;
      expect(requireActiveWorkspace(session)).toEqual({ id: "org_123" });
    });

    it("throws when no active organization exists", () => {
      const session = {
        workspace: { activeOrganization: null },
      } as unknown as AtlasSessionPayload;
      expect(() => requireActiveWorkspace(session)).toThrow(
        "Choose or create a workspace before managing organization settings.",
      );
    });
  });

  describe("requireManagedTeamWorkspace", () => {
    it("returns the workspace when it is a team and managed by the user", () => {
      const workspace = { workspaceType: "team", role: "owner" };
      const session = {
        workspace: { activeOrganization: workspace },
      } as unknown as AtlasSessionPayload;
      mocks.canManageAtlasOrganizationRole.mockReturnValue(true);

      expect(requireManagedTeamWorkspace(session)).toBe(workspace);
    });

    it("throws when the workspace is not a team", () => {
      const workspace = { workspaceType: "individual", role: "owner" };
      const session = {
        workspace: { activeOrganization: workspace },
      } as unknown as AtlasSessionPayload;

      expect(() => requireManagedTeamWorkspace(session)).toThrow(
        "Team management is only available inside team workspaces.",
      );
    });

    it("throws when the user cannot manage the organization", () => {
      const workspace = { workspaceType: "team", role: "member" };
      const session = {
        workspace: { activeOrganization: workspace },
      } as unknown as AtlasSessionPayload;
      mocks.canManageAtlasOrganizationRole.mockReturnValue(false);

      expect(() => requireManagedTeamWorkspace(session)).toThrow(
        "You do not have permission to manage this workspace.",
      );
    });
  });
});
