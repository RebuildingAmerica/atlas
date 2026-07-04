import { useMutation } from "@tanstack/react-query";
import { createWorkspaceBrief, updateWorkspaceBrief } from "@/domains/workspace/server/briefs";
import { recordWorkspaceEvidenceOpen } from "@/domains/workspace/server/usage-summary";
import type {
  AtlasBriefCreateInput,
  AtlasBriefUpdateInput,
} from "@/domains/workspace/server/briefs";
import type { RecordWorkspaceEvidenceOpenInput } from "@/domains/workspace/server/usage-summary";

export interface UpdateWorkspaceBriefVariables extends AtlasBriefUpdateInput {
  briefId: string;
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
