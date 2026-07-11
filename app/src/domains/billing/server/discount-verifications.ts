import "@tanstack/react-start/server-only";

import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import type { DiscountSegment } from "../discount-segments";

/**
 * Returns the verified discount segment for a workspace, if one has been approved.
 */
export async function getVerifiedDiscountSegmentForWorkspace(
  workspaceId: string,
): Promise<DiscountSegment | null> {
  const params = new URLSearchParams({
    organization_id: workspaceId,
    status: "verified",
  });
  const response = await requestAtlasApi<VerificationListResponse>(
    `/admin/verifications?${params.toString()}`,
  );

  return response.records[0]?.segment ?? null;
}
