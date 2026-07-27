import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AtlasBrief,
  AtlasBriefCollection,
  AtlasBriefCreateInput,
  AtlasBriefExport,
  AtlasBriefUpdateInput,
} from "@/domains/workspace/server/briefs";
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

describe("workspace brief server loader", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads a private brief export for the active workspace", async () => {
    const briefExport = {
      format: "json",
      brief: { id: "brief_123", title: "Tenant Power Brief" },
      entries: [],
      sources: [],
      discovery_runs: [],
      provenance: {
        source_count: 0,
        entry_count: 0,
        discovery_run_count: 0,
        confidence_state: "corroborated",
        review_status: "reviewed",
      },
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(briefExport);

    const { loadWorkspaceBriefExportData } = await import("@/domains/workspace/server/briefs");
    const result = await loadWorkspaceBriefExportData("brief_123");

    expect(result).toBe(briefExport);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs/brief_123/export");
  });

  it("loads private briefs for the active workspace", async () => {
    const briefCollection = {
      items: [
        {
          id: "brief_123",
          org_id: "org_123",
          title: "Tenant Power Brief",
          scope: {
            geography: "Kansas City, MO",
            issue_areas: ["housing"],
            actor_types: ["organization"],
            source_types: ["news"],
          },
          summary: "A source-linked brief.",
          linked_entry_ids: ["entry_1"],
          linked_source_ids: ["source_1"],
          linked_discovery_run_ids: ["run_1"],
          confidence_summary: {
            source_count: 1,
            state: "partial",
            review_status: "reviewed",
          },
          gaps: [],
          created_by: "operator_1",
          created_at: "2026-07-03T10:00:00.000Z",
          updated_at: "2026-07-03T11:00:00.000Z",
        },
      ],
      total: 1,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(briefCollection);

    const { loadWorkspaceBriefsData } = await import("@/domains/workspace/server/briefs");
    const result = await loadWorkspaceBriefsData();

    expect(result).toBe(briefCollection);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs");
  });

  it("creates a private brief for the active workspace", async () => {
    const brief: AtlasBrief = {
      id: "brief_123",
      org_id: "org_123",
      title: "Tenant Power Brief",
      scope: {
        geography: "Kansas City, MO",
        issue_areas: ["housing"],
        actor_types: ["organization"],
        source_types: ["web"],
      },
      summary: "A source-linked brief.",
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["source_1"],
      linked_discovery_run_ids: ["run_1"],
      confidence_summary: {
        source_count: 1,
        state: "partial",
        review_status: "needs review",
      },
      gaps: [],
      created_by: "operator_1",
      created_at: "2026-07-03T10:00:00.000Z",
      updated_at: "2026-07-03T11:00:00.000Z",
    };
    const input: AtlasBriefCreateInput = {
      title: "Tenant Power Brief",
      scope: brief.scope,
      summary: brief.summary,
      linked_entry_ids: brief.linked_entry_ids,
      linked_source_ids: brief.linked_source_ids,
      linked_discovery_run_ids: brief.linked_discovery_run_ids,
      confidence_summary: brief.confidence_summary,
      gaps: brief.gaps,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(brief);

    const { createWorkspaceBriefData } = await import("@/domains/workspace/server/briefs");
    const result = await createWorkspaceBriefData(input);

    expect(result).toBe(brief);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs", {
      body: JSON.stringify(input),
      method: "POST",
    });
  });

  it("updates editable private brief fields for the active workspace", async () => {
    const updatedBrief: AtlasBrief = {
      id: "brief_123",
      org_id: "org_123",
      title: "Reviewed Tenant Power Brief",
      scope: {
        geography: "Kansas City, MO",
        issue_areas: ["housing"],
        actor_types: ["organization"],
        source_types: ["web"],
      },
      summary: "Reviewed source-linked summary.",
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["source_1"],
      linked_discovery_run_ids: ["run_1"],
      confidence_summary: {
        source_count: 1,
        state: "corroborated",
        review_status: "reviewed by research",
      },
      gaps: [
        {
          label: "County organizers",
          detail: "Confirm county-level organizing before regional outreach.",
        },
      ],
      created_by: "operator_1",
      created_at: "2026-07-03T10:00:00.000Z",
      updated_at: "2026-07-03T11:30:00.000Z",
    };
    const input: AtlasBriefUpdateInput = {
      confidence_summary: updatedBrief.confidence_summary,
      gaps: updatedBrief.gaps,
      summary: updatedBrief.summary,
      title: updatedBrief.title,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(updatedBrief);

    const { updateWorkspaceBriefData } = await import("@/domains/workspace/server/briefs");
    const result = await updateWorkspaceBriefData("brief_123", input);

    expect(result).toBe(updatedBrief);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs/brief_123", {
      body: JSON.stringify(input),
      method: "PATCH",
    });
  });

  it("fails before fetching when there is no active workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: null,
      },
    });

    const { loadWorkspaceBriefExportData } = await import("@/domains/workspace/server/briefs");

    await expect(loadWorkspaceBriefExportData("brief_123")).rejects.toThrow(
      "Open a workspace before loading Atlas Briefs.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});

describe("workspace brief server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  function briefFields() {
    return {
      confidence_summary: {
        review_status: "Reviewed by desk",
        source_count: 3,
        state: "corroborated",
      },
      gaps: [{ detail: "No county filings yet.", label: "Filings" }],
      linked_discovery_run_ids: ["run_1"],
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["src_1"],
      scope: {
        actor_types: ["organization"],
        geography: "Tulsa, OK",
        issue_areas: ["housing_affordability"],
        source_types: ["news"],
      },
      summary: "Who is organizing Tulsa tenants.",
      title: "Tulsa tenant power",
    };
  }

  it("returns a brief export through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ brief: { id: "brief 1" }, format: "json" });

    const { loadWorkspaceBriefExport } = await import("@/domains/workspace/server/briefs");
    const response = (await loadWorkspaceBriefExport.__executeServer({
      data: { briefId: "brief 1" },
      method: "GET",
    })) as ServerFnExecutionResponse<AtlasBriefExport>;

    expect(response.error).toBeUndefined();
    expect(response.result?.brief.id).toBe("brief 1");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs/brief%201/export");
  });

  it("rejects a brief export request with a blank brief id", async () => {
    const { loadWorkspaceBriefExport } = await import("@/domains/workspace/server/briefs");
    const response = (await loadWorkspaceBriefExport.__executeServer({
      data: { briefId: "" },
      method: "GET",
    })) as ServerFnExecutionResponse<AtlasBriefExport>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("returns the brief collection through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [{ id: "brief_1" }], total: 1 });

    const { loadWorkspaceBriefs } = await import("@/domains/workspace/server/briefs");
    const response = (await loadWorkspaceBriefs.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse<AtlasBriefCollection>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ items: [{ id: "brief_1" }], total: 1 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs");
  });

  it("creates a brief through the POST server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "brief_1", title: "Tulsa tenant power" });

    const { createWorkspaceBrief } = await import("@/domains/workspace/server/briefs");
    const response = (await createWorkspaceBrief.__executeServer({
      data: briefFields(),
      method: "POST",
    })) as ServerFnExecutionResponse<AtlasBrief>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "brief_1", title: "Tulsa tenant power" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs", {
      body: JSON.stringify(briefFields()),
      method: "POST",
    });
  });

  it("rejects a brief created without a title", async () => {
    const { createWorkspaceBrief } = await import("@/domains/workspace/server/briefs");
    const response = (await createWorkspaceBrief.__executeServer({
      data: { ...briefFields(), title: "" },
      method: "POST",
    })) as ServerFnExecutionResponse<AtlasBrief>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("updates only the reviewed fields a brief editor changed", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "brief_1", title: "Revised title" });

    const { updateWorkspaceBrief } = await import("@/domains/workspace/server/briefs");
    const response = (await updateWorkspaceBrief.__executeServer({
      data: { briefId: "brief_1", title: "Revised title" },
      method: "POST",
    })) as ServerFnExecutionResponse<AtlasBrief>;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "brief_1", title: "Revised title" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/briefs/brief_1", {
      body: JSON.stringify({ title: "Revised title" }),
      method: "PATCH",
    });
  });

  it("rejects a brief update that changes nothing", async () => {
    const { updateWorkspaceBrief } = await import("@/domains/workspace/server/briefs");
    const response = (await updateWorkspaceBrief.__executeServer({
      data: { briefId: "brief_1" },
      method: "POST",
    })) as ServerFnExecutionResponse<AtlasBrief>;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});

describe("workspace brief id handling", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("refuses a brief export request whose id is only whitespace", async () => {
    const { loadWorkspaceBriefExportData } = await import("@/domains/workspace/server/briefs");

    await expect(loadWorkspaceBriefExportData("   ")).rejects.toThrow("Brief id is required.");
    expect(mocks.requireReadyAtlasSessionState).not.toHaveBeenCalled();
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("refuses a brief update whose id is only whitespace", async () => {
    const { updateWorkspaceBriefData } = await import("@/domains/workspace/server/briefs");

    await expect(updateWorkspaceBriefData("   ", { title: "New title" })).rejects.toThrow(
      "Brief id is required.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
