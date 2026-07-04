// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoverageTargetCollection,
  CoverageTargetCreateInput,
} from "@/domains/workspace/server/coverage-targets";

const mocks = vi.hoisted(() => ({
  createWorkspaceCoverageTarget: vi.fn(),
  invalidateQueries: vi.fn(),
  loadWorkspaceCoverageTargets: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/domains/workspace/server/coverage-targets", () => ({
  createWorkspaceCoverageTarget: mocks.createWorkspaceCoverageTarget,
  loadWorkspaceCoverageTargets: mocks.loadWorkspaceCoverageTargets,
}));

describe("coverage target hooks", () => {
  interface CoverageTargetsQueryConfig {
    initialData: CoverageTargetCollection;
    queryFn(): Promise<unknown>;
    queryKey: readonly string[];
  }

  interface CreateCoverageTargetMutationConfig {
    mutationFn(data: CoverageTargetCreateInput): Promise<unknown>;
    onSuccess?(): Promise<void> | void;
  }

  beforeEach(() => {
    vi.resetModules();
    mocks.createWorkspaceCoverageTarget.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.loadWorkspaceCoverageTargets.mockReset();
    mocks.useMutation.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQueryClient.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
    mocks.useMutation.mockImplementation((config: CreateCoverageTargetMutationConfig) => config);
  });

  function collection(): CoverageTargetCollection {
    return { items: [], total: 0 };
  }

  function queryConfig(): CoverageTargetsQueryConfig {
    const call = mocks.useQuery.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useQuery to receive a config object.");
    }

    return call[0] as CoverageTargetsQueryConfig;
  }

  function mutationConfig(): CreateCoverageTargetMutationConfig {
    const call = mocks.useMutation.mock.calls.at(0) as [unknown] | undefined;
    if (!call) {
      throw new TypeError("Expected useMutation to receive a config object.");
    }

    return call[0] as CreateCoverageTargetMutationConfig;
  }

  it("hydrates coverage targets from the route loader payload", async () => {
    const initialTargets = collection();
    const mod = await import("@/domains/workspace/hooks/use-coverage-targets");
    renderHook(() => mod.useCoverageTargets(initialTargets));

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "coverage-targets"]);
    expect(config.initialData).toBe(initialTargets);
    await config.queryFn();
    expect(mocks.loadWorkspaceCoverageTargets).toHaveBeenCalledWith();
  });

  it("creates a coverage target and refreshes the workspace list", async () => {
    const mod = await import("@/domains/workspace/hooks/use-coverage-targets");
    renderHook(() => mod.useCreateCoverageTarget());

    const input: CoverageTargetCreateInput = {
      actor_types: ["organization"],
      geography: "Kansas City, MO",
      issue_areas: ["housing_affordability"],
      name: "Kansas City tenant power",
      source_types: ["news"],
    };
    const config = mutationConfig();
    await config.mutationFn(input);
    expect(mocks.createWorkspaceCoverageTarget).toHaveBeenCalledWith({ data: input });

    await config.onSuccess?.();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "coverage-targets"],
    });
  });
});
