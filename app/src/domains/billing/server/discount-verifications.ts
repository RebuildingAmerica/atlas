import "@tanstack/react-start/server-only";

import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import type { DiscountSegment } from "../discount-segments";

export interface CurrentDiscountVerificationRecord {
  id: string;
  organization_id: string;
  segment: DiscountSegment;
  status: "pending" | "verified" | "rejected" | "expired";
  submitted_at: string;
  verified_at?: string | null;
}

export interface CurrentDiscountVerificationResponse {
  record: CurrentDiscountVerificationRecord | null;
}

/**
 * Returns the verified discount segment for a workspace, if one has been approved.
 */
export async function getVerifiedDiscountSegmentForWorkspace(
  workspaceId: string,
): Promise<DiscountSegment | null> {
  const response = await requestAtlasApi<CurrentDiscountVerificationResponse>(
    "/access/discount-verification/current",
  );
  const record = response.record;

  if (record?.organization_id !== workspaceId || record?.status !== "verified") {
    return null;
  }

  return record.segment;
}
