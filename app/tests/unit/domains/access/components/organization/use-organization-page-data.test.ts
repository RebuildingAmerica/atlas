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

describe("useOrganizationPageData", () => {
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

  it("loads directory config only for public-directory workspaces", () => {
    const directoryQueryFn = vi.fn();
    const sessionWithDirectories = {
      workspace: {
        ...session.workspace,
        resolvedCapabilities: {
          ...mocks.resolvedCapabilities,
          capabilities: ["research.run", "public.directories"],
        },
      },
    };
    mocks.useAtlasSession.mockReturnValue({ data: sessionWithDirectories, refetch: vi.fn() });
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_1" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: [] },
      isLoading: false,
    }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: null, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      directoryQueryFn.mockImplementation(queryFn);
      return {
        data: { org_id: "org_1", title: "Detroit tenant power directory" },
        isLoading: false,
      };
    });
    mocks.loadWorkspaceDirectoryConfig.mockResolvedValue({
      org_id: "org_1",
      title: "Detroit tenant power directory",
    });

    const { result } = renderHook(() => useOrganizationPageData());
    directoryQueryFn();

    expect(mocks.loadWorkspaceDirectoryConfig).toHaveBeenCalled();
    expect(result.current.canUsePublicDirectories).toBe(true);
    expect(result.current.directoryConfig?.title).toBe("Detroit tenant power directory");
  });

  it("loads usage summary for workspace managers", () => {
    const usageSummaryQueryFn = vi.fn();
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          ...session.workspace,
          activeOrganization: { id: "org_admin", role: "owner" },
        },
      },
      refetch: vi.fn(),
    });
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_admin" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: [] },
      isLoading: false,
    }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: null, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      usageSummaryQueryFn.mockImplementation(queryFn);
      return {
        data: {
          event_counts: { brief_opened: 2 },
          org_id: "org_admin",
          renewal_signals: {
            briefs_used: 2,
            coverage_gaps_closed: 0,
            integrations_used: 0,
            public_records_improved: 0,
            team_workflow_actions: 0,
          },
          total_events: 2,
        },
        isLoading: false,
      };
    });
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.loadWorkspaceUsageSummary.mockResolvedValue({ total_events: 2 });

    const { result } = renderHook(() => useOrganizationPageData());
    usageSummaryQueryFn();

    expect(mocks.loadWorkspaceUsageSummary).toHaveBeenCalled();
    expect(result.current.usageSummary?.total_events).toBe(2);
    expect(result.current.usageSummaryLoading).toBe(false);
  });

  it("loads usage audit log for workspace managers", () => {
    const usageAuditLogQueryFn = vi.fn();
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          ...session.workspace,
          activeOrganization: { id: "org_admin", role: "owner" },
        },
      },
      refetch: vi.fn(),
    });
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_admin" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: [] },
      isLoading: false,
    }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: null, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      usageAuditLogQueryFn.mockImplementation(queryFn);
      return {
        data: {
          data_boundary: {
            metadata_included: false,
            session_replay_included: false,
            statement:
              "The audit log shows timestamped workspace usage events without private metadata or behavioral session replay.",
          },
          items: [],
          limit: 10,
          offset: 0,
          org_id: "org_admin",
          total: 0,
        },
        isLoading: false,
      };
    });
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.loadWorkspaceUsageAuditLog.mockResolvedValue({ total: 0 });

    const { result } = renderHook(() => useOrganizationPageData());
    usageAuditLogQueryFn();

    expect(mocks.loadWorkspaceUsageAuditLog).toHaveBeenCalled();
    expect(result.current.usageAuditLog?.total).toBe(0);
    expect(result.current.usageAuditLogLoading).toBe(false);
  });

  it("loads integration monitoring for workspace managers", () => {
    const integrationMonitoringQueryFn = vi.fn();
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          ...session.workspace,
          activeOrganization: { id: "org_admin", role: "owner" },
        },
      },
      refetch: vi.fn(),
    });
    mocks.useQuery.mockImplementationOnce(() => ({ data: { id: "org_admin" }, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({
      data: { issuerOrigins: [] },
      isLoading: false,
    }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: null, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(() => ({ data: undefined, isLoading: false }));
    mocks.useQuery.mockImplementationOnce(({ queryFn }: { queryFn: () => unknown }) => {
      integrationMonitoringQueryFn.mockImplementation(queryFn);
      return {
        data: {
          api_calls: 2,
          last_seen_at: "2026-07-03T12:00:00.000Z",
          mcp_calls: 1,
          org_id: "org_admin",
          top_resources: [],
          total_calls: 3,
        },
        isLoading: false,
      };
    });
    mocks.loadWorkspaceIntegrationMonitoring.mockResolvedValue({ total_calls: 3 });

    const { result } = renderHook(() => useOrganizationPageData());
    integrationMonitoringQueryFn();

    expect(mocks.loadWorkspaceIntegrationMonitoring).toHaveBeenCalled();
    expect(result.current.integrationMonitoring?.total_calls).toBe(3);
    expect(result.current.integrationMonitoringLoading).toBe(false);
  });

  it("disables usage summary for non-managing workspace members", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          ...session.workspace,
          activeOrganization: { id: "org_member", role: "member" },
        },
      },
      refetch: vi.fn(),
    });

    renderHook(() => useOrganizationPageData());

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ["workspace", "usage-summary", "org_member"],
      }),
    );
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ["workspace", "usage-audit-log", "org_member"],
      }),
    );
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ["workspace", "integration-monitoring", "org_member"],
      }),
    );
  });
});
