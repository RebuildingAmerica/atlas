import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoverageTarget,
  CoverageTargetCollection,
  CoverageTargetCreateInput,
  CoverageTargetDetail,
  CoverageTargetImportInput,
  CoverageTargetImportResult,
  CoverageUnderwritingReport,
  CoverageWorkspacePayload,
} from "@/domains/workspace/server/coverage-targets";
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

describe("workspace coverage target server loader", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads private coverage targets for the active workspace", async () => {
    const collection = { items: [], total: 0 };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(collection);

    const { loadWorkspaceCoverageTargetsData } =
      await import("@/domains/workspace/server/coverage-targets");
    const result = await loadWorkspaceCoverageTargetsData();

    expect(result).toBe(collection);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets");
  });

  it("loads coverage workspace data with the active org id", async () => {
    const collection = { items: [], total: 0 };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(collection);

    const { loadWorkspaceCoverageData } =
      await import("@/domains/workspace/server/coverage-targets");
    const result = await loadWorkspaceCoverageData();

    expect(result).toEqual({ coverageTargets: collection, orgId: "org_123" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets");
  });

  it("loads one coverage target detail for the active workspace", async () => {
    const detail = { target: { id: "coverage_123" }, discovery_runs: [], entries: [] };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(detail);

    const { loadWorkspaceCoverageTargetDetailData } =
      await import("@/domains/workspace/server/coverage-targets");
    const result = await loadWorkspaceCoverageTargetDetailData("coverage_123");

    expect(result).toBe(detail);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/orgs/org_123/coverage-targets/coverage_123",
    );
  });

  it("loads the coverage underwriting report for the active workspace", async () => {
    const report = {
      data_boundary: {
        exclusive_public_data_access: false,
        private_workspace_notes_included: false,
        statement: "Underwriting improves public coverage.",
      },
      generated_at: "2026-07-03T12:00:00+00:00",
      org_id: "org_123",
      public_impact: {
        coverage_gaps_closed: 1,
        public_records_improved: 2,
        records_found: 4,
        sources_reviewed: 5,
      },
      summary: {
        blocked: 0,
        covered: 1,
        needs_work: 0,
        next_actions: 0,
        open_gaps: 0,
        records_found: 4,
        sources_reviewed: 5,
        stale: 0,
        thin: 0,
        total_targets: 1,
        unknown: 0,
      },
      targets: [],
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(report);

    const { loadWorkspaceCoverageUnderwritingReportData } =
      await import("@/domains/workspace/server/coverage-targets");
    const result = await loadWorkspaceCoverageUnderwritingReportData();

    expect(result).toBe(report);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-reports");
  });

  it("creates a private coverage target for the active workspace", async () => {
    const input: CoverageTargetCreateInput = {
      actor_types: ["organization"],
      geography: "Kansas City, MO",
      issue_areas: ["housing_affordability"],
      name: "Kansas City tenant power",
      source_types: ["news"],
    };
    const target = { id: "coverage_123", ...input };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(target);

    const { createWorkspaceCoverageTargetData } =
      await import("@/domains/workspace/server/coverage-targets");
    const result = await createWorkspaceCoverageTargetData(input);

    expect(result).toBe(target);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets", {
      body: JSON.stringify(input),
      method: "POST",
    });
  });

  it("imports private coverage targets for the active workspace", async () => {
    const input: CoverageTargetImportInput = {
      csv_text: "name,geography,issue_areas,actor_types,source_types\n",
    };
    const result = { created: [], imported: 0 };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(result);

    const { importWorkspaceCoverageTargetsData } =
      await import("@/domains/workspace/server/coverage-targets");
    const imported = await importWorkspaceCoverageTargetsData(input);

    expect(imported).toBe(result);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets/import", {
      body: JSON.stringify(input),
      method: "POST",
    });
  });

  it("fails before fetching when there is no active workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: null,
      },
    });

    const { loadWorkspaceCoverageTargetsData } =
      await import("@/domains/workspace/server/coverage-targets");

    await expect(loadWorkspaceCoverageTargetsData()).rejects.toThrow(
      "Open a workspace before loading coverage targets.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});

describe("workspace coverage target server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("returns the coverage target collection through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [{ id: "target_1" }], total: 1 });

    const { loadWorkspaceCoverageTargets } =
      await import("@/domains/workspace/server/coverage-targets");
    const response = (await loadWorkspaceCoverageTargets.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<CoverageTargetCollection>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ items: [{ id: "target_1" }], total: 1 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets");
  });

  it("returns coverage workspace data with the workspace id the route renders under", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], total: 0 });

    const { loadWorkspaceCoverage } = await import("@/domains/workspace/server/coverage-targets");
    const response = (await loadWorkspaceCoverage.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<CoverageWorkspacePayload>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ coverageTargets: { items: [], total: 0 }, orgId: "org_123" });
  });

  it("returns one coverage target detail through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      discovery_runs: [],
      entries: [],
      target: { id: "target 1", name: "Tulsa housing" },
    });

    const { loadWorkspaceCoverageTargetDetail } =
      await import("@/domains/workspace/server/coverage-targets");
    const response = (await loadWorkspaceCoverageTargetDetail.__executeServer({
      data: { targetId: "target 1" },
      method: "GET",
    })) as ServerFnExecutionResponse<CoverageTargetDetail>;

    expect(response.error).toBeUndefined();
    expect(response.result?.target.name).toBe("Tulsa housing");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets/target%201");
  });

  it("rejects a coverage target detail request with a blank target id", async () => {
    const { loadWorkspaceCoverageTargetDetail } =
      await import("@/domains/workspace/server/coverage-targets");
    const response = (await loadWorkspaceCoverageTargetDetail.__executeServer({
      data: { targetId: "" },
      method: "GET",
    })) as ServerFnExecutionResponse<CoverageTargetDetail>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("returns the underwriting report through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ org_id: "org_123", targets: [] });

    const { loadWorkspaceCoverageUnderwritingReport } =
      await import("@/domains/workspace/server/coverage-targets");
    const response = (await loadWorkspaceCoverageUnderwritingReport.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<CoverageUnderwritingReport>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ org_id: "org_123", targets: [] });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-reports");
  });

  it("creates a coverage target through the POST server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "target_1", name: "Tulsa housing" });

    const { createWorkspaceCoverageTarget } =
      await import("@/domains/workspace/server/coverage-targets");
    const input = {
      actor_types: ["organization"],
      geography: "Tulsa, OK",
      issue_areas: ["housing_affordability"],
      name: "Tulsa housing",
      source_types: ["news"],
    };
    const response = (await createWorkspaceCoverageTarget.__executeServer({
      data: input,
      method: "POST",
    })) as ServerFnExecutionResponse<CoverageTarget>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "target_1", name: "Tulsa housing" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets", {
      body: JSON.stringify(input),
      method: "POST",
    });
  });

  it("rejects a coverage target created without any issue area", async () => {
    const { createWorkspaceCoverageTarget } =
      await import("@/domains/workspace/server/coverage-targets");
    const response = (await createWorkspaceCoverageTarget.__executeServer({
      data: {
        actor_types: ["organization"],
        geography: "Tulsa, OK",
        issue_areas: [],
        name: "Tulsa housing",
        source_types: ["news"],
      },
      method: "POST",
    })) as ServerFnExecutionResponse<CoverageTarget>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("imports coverage targets from a CSV through the POST server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ created: 2, items: [] });

    const { importWorkspaceCoverageTargets } =
      await import("@/domains/workspace/server/coverage-targets");
    const response = (await importWorkspaceCoverageTargets.__executeServer({
      data: { csv_text: "name,geography\nTulsa housing,Tulsa OK" },
      method: "POST",
    })) as ServerFnExecutionResponse<CoverageTargetImportResult>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ created: 2, items: [] });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/coverage-targets/import", {
      body: JSON.stringify({ csv_text: "name,geography\nTulsa housing,Tulsa OK" }),
      method: "POST",
    });
  });
});
