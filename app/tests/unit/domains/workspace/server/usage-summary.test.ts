import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceIntegrationMonitoring,
  WorkspaceUsageAuditLog,
  WorkspaceUsageEvent,
  WorkspaceUsageSummary,
} from "@/domains/workspace/server/usage-summary";
import type { ServerFnExecutionResponse } from "../../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("workspace usage summary server helper", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads renewal usage summary for the active workspace", async () => {
    const summary = {
      event_counts: {
        brief_opened: 2,
        public_record_improved: 1,
      },
      org_id: "org_123",
      renewal_signals: {
        briefs_used: 2,
        coverage_gaps_closed: 0,
        integrations_used: 0,
        public_records_improved: 1,
        team_workflow_actions: 0,
      },
      total_events: 3,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: { id: "org_123" },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(summary);

    const { loadWorkspaceUsageSummaryData } =
      await import("@/domains/workspace/server/usage-summary");
    const result = await loadWorkspaceUsageSummaryData();

    expect(result).toBe(summary);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/usage-summary");
  });

  it("fails before fetching when there is no active workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: null,
      },
    });

    const { loadWorkspaceUsageSummaryData } =
      await import("@/domains/workspace/server/usage-summary");

    await expect(loadWorkspaceUsageSummaryData()).rejects.toThrow(
      "Open a workspace before loading renewal proof.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("records a workspace evidence-open event for the active workspace", async () => {
    const event = {
      actor_id: "user_123",
      created_at: "2026-07-03T12:00:00.000Z",
      event_type: "evidence_opened",
      id: "event_123",
      org_id: "org_123",
      resource_id: "source_123",
      resource_type: "source",
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: { id: "org_123" },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(event);

    const { recordWorkspaceEvidenceOpenData } =
      await import("@/domains/workspace/server/usage-summary");
    const result = await recordWorkspaceEvidenceOpenData({
      sourceId: "source_123",
      surface: "brief",
    });

    expect(result).toBe(event);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/usage-summary/evidence-opens",
      {
        body: JSON.stringify({
          source_id: "source_123",
          surface: "brief",
        }),
        method: "POST",
      },
    );
  });

  it("loads the customer-safe usage audit log for the active workspace", async () => {
    const auditLog = {
      data_boundary: {
        metadata_included: false,
        session_replay_included: false,
        statement:
          "The audit log shows timestamped workspace usage events without private metadata or behavioral session replay.",
      },
      items: [
        {
          actor_id: "user_123",
          created_at: "2026-07-03T12:00:00.000Z",
          event_type: "api_call",
          id: "event_123",
          org_id: "org_123",
          resource_id: "GET /api/profiles/{slug}",
          resource_type: "api",
        },
      ],
      limit: 10,
      offset: 0,
      org_id: "org_123",
      total: 1,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: { id: "org_123" },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(auditLog);

    const { loadWorkspaceUsageAuditLogData } =
      await import("@/domains/workspace/server/usage-summary");
    const result = await loadWorkspaceUsageAuditLogData({ limit: 10 });

    expect(result).toBe(auditLog);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/usage-summary/audit-log?limit=10&offset=0",
    );
  });

  it("loads the workspace integration activity summary for the active workspace", async () => {
    const integrationMonitoring = {
      api_calls: 2,
      data_boundary: {
        request_metadata_included: false,
        session_replay_included: false,
        statement:
          "Workspace integration activity records counts, surfaces, paths, and last-seen times without request metadata or behavioral session replay.",
      },
      last_seen_at: "2026-07-03T12:00:00.000Z",
      mcp_calls: 1,
      org_id: "org_123",
      top_resources: [
        {
          last_seen_at: "2026-07-03T12:00:00.000Z",
          resource_id: "/mcp",
          surface: "mcp",
          total_calls: 1,
        },
      ],
      total_calls: 3,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: { id: "org_123" },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(integrationMonitoring);

    const { loadWorkspaceIntegrationMonitoringData } =
      await import("@/domains/workspace/server/usage-summary");
    const result = await loadWorkspaceIntegrationMonitoringData();

    expect(result).toBe(integrationMonitoring);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/usage-summary/integrations");
  });

  it("falls back to the first page of the audit log when no bounds are given", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
    mocks.requestAtlasApi.mockResolvedValue({ items: [], limit: 10, offset: 0, total: 0 });

    const { loadWorkspaceUsageAuditLogData } =
      await import("@/domains/workspace/server/usage-summary");
    await loadWorkspaceUsageAuditLogData();

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/usage-summary/audit-log?limit=10&offset=0",
    );
  });
});

describe("workspace usage summary server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("returns the renewal usage summary through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ org_id: "org_123", total_events: 5 });

    const { loadWorkspaceUsageSummary } = await import("@/domains/workspace/server/usage-summary");
    const response = (await loadWorkspaceUsageSummary.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceUsageSummary>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ org_id: "org_123", total_events: 5 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/usage-summary");
  });

  it("returns the audit log page the caller asked for", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], limit: 25, offset: 50, total: 90 });

    const { loadWorkspaceUsageAuditLog } = await import("@/domains/workspace/server/usage-summary");
    const response = (await loadWorkspaceUsageAuditLog.__executeServer({
      data: { limit: 25, offset: 50 },
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceUsageAuditLog>;

    expect(response.error).toBeUndefined();
    expect(response.result?.offset).toBe(50);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/usage-summary/audit-log?limit=25&offset=50",
    );
  });

  it("defaults the audit log to the first page when the route passes no bounds", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], limit: 10, offset: 0, total: 0 });

    const { loadWorkspaceUsageAuditLog } = await import("@/domains/workspace/server/usage-summary");
    const response = (await loadWorkspaceUsageAuditLog.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceUsageAuditLog>;

    expect(response.error).toBeUndefined();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/usage-summary/audit-log?limit=10&offset=0",
    );
  });

  it("returns integration activity through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ org_id: "org_123", total_calls: 3 });

    const { loadWorkspaceIntegrationMonitoring } =
      await import("@/domains/workspace/server/usage-summary");
    const response = (await loadWorkspaceIntegrationMonitoring.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<WorkspaceIntegrationMonitoring>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ org_id: "org_123", total_calls: 3 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/usage-summary/integrations");
  });

  it("records an evidence open for the surface the reader was on", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ event_type: "evidence_opened", id: "event_1" });

    const { recordWorkspaceEvidenceOpen } =
      await import("@/domains/workspace/server/usage-summary");
    const response = (await recordWorkspaceEvidenceOpen.__executeServer({
      data: { sourceId: "src_1", surface: "brief" },
      method: "POST",
    })) as ServerFnExecutionResponse<WorkspaceUsageEvent>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ event_type: "evidence_opened", id: "event_1" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/usage-summary/evidence-opens",
      {
        body: JSON.stringify({ source_id: "src_1", surface: "brief" }),
        method: "POST",
      },
    );
  });

  it("rejects an evidence open recorded against an unknown surface", async () => {
    const { recordWorkspaceEvidenceOpen } =
      await import("@/domains/workspace/server/usage-summary");
    const response = (await recordWorkspaceEvidenceOpen.__executeServer({
      data: { sourceId: "src_1", surface: "billboard" },
      method: "POST",
    })) as ServerFnExecutionResponse<WorkspaceUsageEvent>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
