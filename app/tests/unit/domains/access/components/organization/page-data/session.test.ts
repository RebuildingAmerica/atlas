// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOrganizationPageData } from "@/domains/access/components/organization/use-organization-page-data";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  useAtlasSession: vi.fn(),
  getOrganizationDetails: vi.fn(),
  getTeamSeatCostSummary: vi.fn(),
  getWorkspaceSAMLAllowedIssuers: vi.fn(),
  loadWorkspaceDirectoryConfig: vi.fn(),
  loadWorkspaceIntegrationMonitoring: vi.fn(),
  loadWorkspaceUsageAuditLog: vi.fn(),
  loadWorkspaceUsageSummary: vi.fn(),
  resolvedCapabilities: {
    capabilities: ["research.run"],
    limits: {
      api_requests_per_day: 0,
      max_api_keys: 0,
      max_members: 1,
      max_shortlist_entries: 25,
      max_shortlists: 1,
      public_api_requests_per_hour: 100,
      research_runs_per_month: 2,
    },
  },
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
  getTeamSeatCostSummary: mocks.getTeamSeatCostSummary,
}));

vi.mock("@/domains/access/sso.functions", () => ({
  getWorkspaceSAMLAllowedIssuers: mocks.getWorkspaceSAMLAllowedIssuers,
}));

vi.mock("@/domains/workspace/server/directory-config", () => ({
  loadWorkspaceDirectoryConfig: mocks.loadWorkspaceDirectoryConfig,
}));

vi.mock("@/domains/workspace/server/usage-summary", () => ({
  loadWorkspaceIntegrationMonitoring: mocks.loadWorkspaceIntegrationMonitoring,
  loadWorkspaceUsageAuditLog: mocks.loadWorkspaceUsageAuditLog,
  loadWorkspaceUsageSummary: mocks.loadWorkspaceUsageSummary,
}));

describe("useOrganizationPageData session", () => {
  const session = {
    workspace: {
      activeOrganization: { id: "org_1" },
      memberships: [],
      pendingInvitations: [],
      capabilities: { canSwitchOrganizations: true },
      onboarding: { hasPendingInvitations: false, needsWorkspace: false },
      resolvedCapabilities: mocks.resolvedCapabilities,
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

    expect(invalidateQueries).toHaveBeenCalledTimes(7);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["auth", "team-seat-cost-summary"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "usage-audit-log"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "integration-monitoring"],
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("invokes the organization queryFn against the API client", () => {
    const organizationQueryFn = vi.fn();
    const samlIssuersQueryFn = vi.fn();
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      organizationQueryFn.mockImplementation(queryFn);
      return { data: { id: "org_1" }, isLoading: false };
    });
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      samlIssuersQueryFn.mockImplementation(queryFn);
      return { data: { issuerOrigins: ["https://idp.example"] }, isLoading: false };
    });
    mocks.getOrganizationDetails.mockResolvedValue({ id: "org_1" });
    mocks.getWorkspaceSAMLAllowedIssuers.mockResolvedValue({ issuerOrigins: [] });

    renderHook(() => useOrganizationPageData());

    organizationQueryFn();
    samlIssuersQueryFn();

    expect(mocks.getOrganizationDetails).toHaveBeenCalled();
    expect(mocks.getWorkspaceSAMLAllowedIssuers).toHaveBeenCalled();
  });

  it("exposes loaded SAML allowed issuer origins to callers", () => {
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_1" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: ["https://idp.example"] },
      isLoading: false,
    }));

    const { result } = renderHook(() => useOrganizationPageData());
    expect(result.current.samlAllowedIssuerOrigins).toEqual(["https://idp.example"]);
  });

  it("returns an empty issuer list when the SAML query returns nothing", () => {
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_1" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));

    const { result } = renderHook(() => useOrganizationPageData());
    expect(result.current.samlAllowedIssuerOrigins).toEqual([]);
  });

  it("forwards initial organization data to useQuery", () => {
    mocks.useQuery.mockClear();
    renderHook(() =>
      useOrganizationPageData({ initialOrganization: { id: "org_initial" } as never }),
    );
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ initialData: { id: "org_initial" } }),
    );
  });

  it("enables the team seat-cost query only for team workspaces", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_team", workspaceType: "team" },
          memberships: [],
          pendingInvitations: [],
          capabilities: { canSwitchOrganizations: true },
          onboarding: { hasPendingInvitations: false, needsWorkspace: false },
          resolvedCapabilities: mocks.resolvedCapabilities,
        },
      },
      refetch: vi.fn(),
    });

    renderHook(() => useOrganizationPageData());

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: ["auth", "team-seat-cost-summary", "org_team"],
      }),
    );
  });

  it("disables the team seat-cost query for individual workspaces", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_solo", workspaceType: "individual" },
          memberships: [],
          pendingInvitations: [],
          capabilities: { canSwitchOrganizations: true },
          onboarding: { hasPendingInvitations: false, needsWorkspace: false },
          resolvedCapabilities: mocks.resolvedCapabilities,
        },
      },
      refetch: vi.fn(),
    });

    renderHook(() => useOrganizationPageData());

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ["auth", "team-seat-cost-summary", "org_solo"],
      }),
    );
  });

  it("exposes the loaded team seat-cost summary and the queryFn calls the server", () => {
    const teamSeatCostQueryFn = vi.fn();
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_1" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: [] },
      isLoading: false,
    }));
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      teamSeatCostQueryFn.mockImplementation(queryFn);
      return { data: { totalCents: 2500 }, isLoading: false };
    });
    mocks.getTeamSeatCostSummary.mockResolvedValue({ totalCents: 2500 });

    const { result } = renderHook(() => useOrganizationPageData());
    teamSeatCostQueryFn();

    expect(mocks.getTeamSeatCostSummary).toHaveBeenCalled();
    expect(result.current.teamSeatCostSummary).toEqual({ totalCents: 2500 });
  });

  it("defaults the team seat-cost summary to null when the query has no data", () => {
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_1" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: [] },
      isLoading: false,
    }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));

    const { result } = renderHook(() => useOrganizationPageData());
    expect(result.current.teamSeatCostSummary).toBeNull();
  });
});
