import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkspaceCoverageTarget,
  importWorkspaceCoverageTargets,
  loadWorkspaceCoverageTargets,
  type CoverageTargetCollection,
  type CoverageTargetCreateInput,
  type CoverageTargetImportInput,
} from "@/domains/workspace/server/coverage-targets";

export const COVERAGE_TARGETS_KEY = ["workspace", "coverage-targets"] as const;

export function useWorkspaceCoverageTargets(enabled: boolean, workspaceId: string | null) {
  return useQuery<CoverageTargetCollection>({
    enabled: enabled && workspaceId !== null,
    queryFn: () => loadWorkspaceCoverageTargets(),
    queryKey: [...COVERAGE_TARGETS_KEY, "snapshot", workspaceId],
  });
}

/**
 * Fetch and cache coverage targets, seeded from the route loader payload.
 *
 * @param initialCoverageTargets - The SSR loader payload used as initial data.
 * @returns React Query result wrapping workspace coverage targets.
 */
export function useCoverageTargets(
  initialCoverageTargets: CoverageTargetCollection,
  workspaceId: string,
) {
  return useQuery<CoverageTargetCollection>({
    initialData: initialCoverageTargets,
    queryFn: () => loadWorkspaceCoverageTargets(),
    queryKey: [...COVERAGE_TARGETS_KEY, "list", workspaceId],
  });
}

/**
 * Creates a coverage target and refreshes the workspace target list.
 */
export function useCreateCoverageTarget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CoverageTargetCreateInput) => createWorkspaceCoverageTarget({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COVERAGE_TARGETS_KEY });
    },
  });
}

/**
 * Imports coverage targets and refreshes the workspace target list.
 */
export function useImportCoverageTargets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CoverageTargetImportInput) => importWorkspaceCoverageTargets({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COVERAGE_TARGETS_KEY });
    },
  });
}
