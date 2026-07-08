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

describe("useOrganizationPageData workspace", () => {
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

  it("loads workspace integration activity for workspace managers", () => {
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
