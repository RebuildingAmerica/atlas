import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createWorkspaceBrief,
  loadWorkspaceBriefs,
  updateWorkspaceBrief,
} from "@/domains/workspace/server/briefs";
import { recordWorkspaceEvidenceOpen } from "@/domains/workspace/server/usage-summary";
import type {
  AtlasBriefCollection,
  AtlasBriefCreateInput,
  AtlasBriefUpdateInput,
} from "@/domains/workspace/server/briefs";
import type { RecordWorkspaceEvidenceOpenInput } from "@/domains/workspace/server/usage-summary";

export interface UpdateWorkspaceBriefVariables extends AtlasBriefUpdateInput {
  briefId: string;
}

export const WORKSPACE_BRIEFS_KEY = ["workspace", "briefs"] as const;

export function useWorkspaceBriefs(enabled: boolean, workspaceId: string | null) {
  return useQuery<AtlasBriefCollection>({
    enabled: enabled && workspaceId !== null,
    queryFn: () => loadWorkspaceBriefs(),
    queryKey: [...WORKSPACE_BRIEFS_KEY, workspaceId],
  });
}

export function useCreateWorkspaceBrief() {
  return useMutation({
    mutationFn: (data: AtlasBriefCreateInput) => createWorkspaceBrief({ data }),
  });
}

export function useUpdateWorkspaceBrief() {
  return useMutation({
    mutationFn: (data: UpdateWorkspaceBriefVariables) => updateWorkspaceBrief({ data }),
  });
}

export function useRecordWorkspaceEvidenceOpen() {
  return useMutation({
    mutationFn: (data: RecordWorkspaceEvidenceOpenInput) => recordWorkspaceEvidenceOpen({ data }),
  });
}
