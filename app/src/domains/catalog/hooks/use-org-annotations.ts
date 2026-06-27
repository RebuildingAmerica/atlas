import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOrgAnnotation,
  listOrgAnnotations,
  type AnnotationCreateRequest,
  type AnnotationResponse,
  type ListOrgAnnotationsParams,
} from "@/lib/generated/atlas";

const ORG_ANNOTATIONS_KEY = ["org-annotations"] as const;

interface OrgAnnotationTarget {
  entryId?: string;
  sourceId?: string;
}

interface CreateOrgAnnotationInput {
  orgId: string;
  body: AnnotationCreateRequest;
}

function buildAnnotationParams(target: OrgAnnotationTarget): ListOrgAnnotationsParams {
  return {
    ...(target.entryId ? { entry_id: target.entryId } : {}),
    ...(target.sourceId ? { source_id: target.sourceId } : {}),
  };
}

export function useOrgAnnotations(
  orgId: string | null | undefined,
  target: OrgAnnotationTarget,
  enabled = true,
) {
  return useQuery<AnnotationResponse[]>({
    queryKey: [...ORG_ANNOTATIONS_KEY, orgId, target.entryId ?? null, target.sourceId ?? null],
    queryFn: () => {
      if (!orgId) {
        throw new Error("Organization ID is required to load private notes.");
      }
      return listOrgAnnotations(orgId, buildAnnotationParams(target));
    },
    enabled: Boolean(orgId) && enabled,
  });
}

export function useCreateOrgAnnotation() {
  const queryClient = useQueryClient();
  return useMutation<AnnotationResponse, unknown, CreateOrgAnnotationInput>({
    mutationFn: ({ orgId, body }) => createOrgAnnotation(orgId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORG_ANNOTATIONS_KEY });
    },
  });
}
