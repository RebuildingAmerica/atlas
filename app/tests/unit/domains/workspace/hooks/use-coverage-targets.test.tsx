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
  loadWorkspaceCoverage: vi.fn(),
  loadWorkspaceCoverageTargets: vi.fn(),
  queryOptions: vi.fn((options: unknown) => options),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  useSuspenseQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: mocks.queryOptions,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
  useSuspenseQuery: mocks.useSuspenseQuery,
}));

vi.mock("@/domains/workspace/server/coverage-targets", () => ({
  createWorkspaceCoverageTarget: mocks.createWorkspaceCoverageTarget,
  loadWorkspaceCoverage: mocks.loadWorkspaceCoverage,
  loadWorkspaceCoverageTargets: mocks.loadWorkspaceCoverageTargets,
}));

describe("coverage target hooks", () => {
  interface CoverageTargetsQueryConfig {
    enabled?: boolean;
    initialData?: CoverageTargetCollection;
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
    mocks.loadWorkspaceCoverage.mockReset();
    mocks.loadWorkspaceCoverageTargets.mockReset();
    mocks.queryOptions.mockClear();
    mocks.useMutation.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQueryClient.mockReset();
    mocks.useSuspenseQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null });
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
    mocks.useSuspenseQuery.mockReturnValue({
      data: { coverageTargets: collection(), orgId: "org_123" },
    });
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

  it("hydrates coverage targets under the active workspace key", async () => {
    const initialTargets = collection();
    const mod = await import("@/domains/workspace/hooks/use-coverage-targets");
    renderHook(() => mod.useCoverageTargets(initialTargets, "org_123"));

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "coverage-targets", "list", "org_123"]);
    expect(config.initialData).toBe(initialTargets);
    await config.queryFn();
    expect(mocks.loadWorkspaceCoverageTargets).toHaveBeenCalledWith();
  });

  it("loads a workspace coverage snapshot when enabled", async () => {
    const mod = await import("@/domains/workspace/hooks/use-coverage-targets");
    renderHook(() => mod.useWorkspaceCoverageTargets(true, "org_123"));

    const config = queryConfig();
    expect(config.queryKey).toEqual(["workspace", "coverage-targets", "snapshot", "org_123"]);
    expect(config.enabled).toBe(true);
    expect(config.initialData).toBeUndefined();
    await config.queryFn();
    expect(mocks.loadWorkspaceCoverageTargets).toHaveBeenCalledWith();
  });

  it("builds shared workspace coverage query options", async () => {
    const workspaceCoverage = { coverageTargets: collection(), orgId: "org_123" };
    mocks.loadWorkspaceCoverage.mockResolvedValue(workspaceCoverage);
    const mod = await import("@/domains/workspace/hooks/use-coverage-targets");

    const options = mod.workspaceCoverageQueryOptions();

    expect(mocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["workspace", "coverage-targets", "workspace"],
      }),
    );
    const queryFn = options.queryFn as () => Promise<unknown>;
    await expect(queryFn()).resolves.toBe(workspaceCoverage);
    expect(mocks.loadWorkspaceCoverage).toHaveBeenCalledWith();
  });

  it("reads shared workspace coverage through suspense query", async () => {
    const mod = await import("@/domains/workspace/hooks/use-coverage-targets");
    renderHook(() => mod.useWorkspaceCoverage());

    expect(mocks.useSuspenseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["workspace", "coverage-targets", "workspace"],
      }),
    );
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
