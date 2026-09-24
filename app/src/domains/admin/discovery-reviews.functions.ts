import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import type {
  ReviewQueueItemResponse,
  ReviewQueueListResponse,
  WebsiteCandidateScanResponse,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";

export interface DiscoveryReview {
  changes: { after: string; before: string; field: string }[];
  entityName: string;
  entitySlug: string | null;
  entityType: string | null;
  holdReason: string;
  id: string;
  sourceUrls: string[];
}

export interface DiscoveryReviewPage {
  items: DiscoveryReview[];
  total: number;
}

const pageSchema = z.object({ offset: z.number().int().nonnegative() });
const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  itemId: z.string().uuid(),
});

export const listDiscoveryReviews = createServerFn({ method: "GET" })
  .validator(pageSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<ReviewQueueListResponse>(
      `/review-queue?limit=25&offset=${data.offset}`,
    );
    return {
      items: (response.items ?? []).map(toReview),
      total: response.total,
    } satisfies DiscoveryReviewPage;
  });

export const decideDiscoveryReview = createServerFn({ method: "POST" })
  .validator(decisionSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<ReviewQueueItemResponse>(
      `/review-queue/${encodeURIComponent(data.itemId)}/${data.decision}`,
      { method: "POST" },
    );
    return { id: response.id, status: response.status };
  });

export const prepareLasVegasWebsiteReviews = createServerFn({ method: "POST" }).handler(
  async () => {
    const response = await requestAtlasApi<WebsiteCandidateScanResponse>(
      "/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV",
      { method: "POST" },
    );
    return { enqueued: response.enqueued };
  },
);

function toReview(item: ReviewQueueItemResponse): DiscoveryReview {
  return {
    changes: Object.entries(item.proposed_changes ?? {}).map(([field, values]) => ({
      after: displayValue(values.after),
      before: displayValue(values.before),
      field,
    })),
    entityName: item.entity_name || "Unnamed profile",
    entitySlug: item.entity_slug ?? null,
    entityType: item.entity_type ?? null,
    holdReason: item.hold_reason,
    id: item.id,
    sourceUrls: item.source_urls ?? [],
  };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None listed";
  if (Array.isArray(value)) return value.map(displayValue).join(", ") || "None listed";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
