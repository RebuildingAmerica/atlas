import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoverageTargetCreateInput,
  CoverageTargetImportInput,
} from "@/domains/workspace/server/coverage-targets";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

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
