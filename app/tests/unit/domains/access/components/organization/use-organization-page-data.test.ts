// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOrganizationPageData } from "@/domains/access/components/organization/use-organization-page-data";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  useAtlasSession: vi.fn(),
  getOrganizationDetails: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
  atlasSessionQueryKey: ["auth", "session"],
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  getOrganizationDetails: mocks.getOrganizationDetails,
}));

describe("useOrganizationPageData", () => {
  const session = {
    workspace: {
      activeOrganization: { id: "org_1" },
      memberships: [],
      pendingInvitations: [],
      capabilities: { canSwitchOrganizations: true },
      onboarding: { hasPendingInvitations: false, needsWorkspace: false },
    },
  };

  beforeEach(() => {
    mocks.useQueryClient.mockReturnValue({
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    });
    mocks.useAtlasSession.mockReturnValue({ data: session, refetch: vi.fn() });
    mocks.useQuery.mockReturnValue({ data: { id: "org_1" }, isLoading: false });
  });

  it("extracts workspace state from session", () => {
    const { result } = renderHook(() => useOrganizationPageData());
    expect(result.current.activeWorkspace?.id).toBe("org_1");
    expect(result.current.canSwitchOrganizations).toBe(true);
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
      }),
    );
  });

  it("disables organization query when no active workspace exists", () => {
    mocks.useAtlasSession.mockReturnValue({ data: null, refetch: vi.fn() });
    renderHook(() => useOrganizationPageData());
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });

  it("provides refresh helper that invalidates queries", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.useQueryClient.mockReturnValue({ invalidateQueries });
    mocks.useAtlasSession.mockReturnValue({ data: session, refetch });

    const { result } = renderHook(() => useOrganizationPageData());
    await result.current.refreshWorkspaceData();

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalled();
  });
});
