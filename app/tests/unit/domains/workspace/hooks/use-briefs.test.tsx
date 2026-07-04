// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AtlasBriefCreateInput,
  AtlasBriefUpdateInput,
} from "@/domains/workspace/server/briefs";

const mocks = vi.hoisted(() => ({
  createWorkspaceBrief: vi.fn(),
  loadWorkspaceBriefs: vi.fn(),
  recordWorkspaceEvidenceOpen: vi.fn(),
  updateWorkspaceBrief: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/workspace/server/briefs", () => ({
  createWorkspaceBrief: mocks.createWorkspaceBrief,
  loadWorkspaceBriefs: mocks.loadWorkspaceBriefs,
  updateWorkspaceBrief: mocks.updateWorkspaceBrief,
}));

vi.mock("@/domains/workspace/server/usage-summary", () => ({
  recordWorkspaceEvidenceOpen: mocks.recordWorkspaceEvidenceOpen,
}));

describe("workspace brief hooks", () => {
  interface BriefsQueryConfig {
    enabled: boolean;
    queryFn(): Promise<unknown>;
    queryKey: readonly string[];
  }

  interface BriefMutationConfig<TInput> {
    mutationFn(data: TInput): Promise<unknown>;
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.createWorkspaceBrief.mockReset();
    mocks.loadWorkspaceBriefs.mockReset();
    mocks.recordWorkspaceEvidenceOpen.mockReset();
    mocks.updateWorkspaceBrief.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
    mocks.useMutation.mockImplementation((config: BriefMutationConfig<unknown>) => config);
  });

  function queryConfig(): BriefsQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }

    return call[0] as BriefsQueryConfig;
  }

  function mutationConfig<TInput>(): BriefMutationConfig<TInput> {
    const call = mocks.useMutation.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useMutation to receive a config object.");
    }

    return call[0] as BriefMutationConfig<TInput>;
  }

  it("loads workspace briefs when enabled", async () => {
    const mod = await import("@/domains/workspace/hooks/use-briefs");
    renderHook(() => mod.useWorkspaceBriefs(true, "org_123"));

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "briefs", "org_123"]);
    expect(config.enabled).toBe(true);
    await config.queryFn();
    expect(mocks.loadWorkspaceBriefs).toHaveBeenCalledWith();
  });

  it("creates a workspace brief", async () => {
    const mod = await import("@/domains/workspace/hooks/use-briefs");
    renderHook(() => mod.useCreateWorkspaceBrief());

    const input: AtlasBriefCreateInput = {
      confidence_summary: { review_status: "reviewed", source_count: 1, state: "partial" },
      gaps: [],
      linked_discovery_run_ids: ["run_1"],
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["source_1"],
      scope: {
        actor_types: ["organization"],
        geography: "Kansas City, MO",
        issue_areas: ["housing_affordability"],
        source_types: ["news"],
      },
      summary: "Source-linked tenant power brief.",
      title: "Tenant power",
    };

    const config = mutationConfig<AtlasBriefCreateInput>();
    await config.mutationFn(input);
    expect(mocks.createWorkspaceBrief).toHaveBeenCalledWith({ data: input });
  });

  it("updates a workspace brief", async () => {
    const mod = await import("@/domains/workspace/hooks/use-briefs");
    renderHook(() => mod.useUpdateWorkspaceBrief());

    const input: AtlasBriefUpdateInput & { briefId: string } = {
      briefId: "brief_123",
      title: "Reviewed brief",
    };

    const config = mutationConfig<AtlasBriefUpdateInput & { briefId: string }>();
    await config.mutationFn(input);
    expect(mocks.updateWorkspaceBrief).toHaveBeenCalledWith({ data: input });
  });
});
