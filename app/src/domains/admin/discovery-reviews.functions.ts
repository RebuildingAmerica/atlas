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
  entityCity?: string | null;
  entityDescription?: string | null;
  entityName: string;
  entitySlug: string | null;
  entityState?: string | null;
  entityType: string | null;
  entityWebsite?: string | null;
  holdReason: string;
  id: string;
  issueAreas?: string[];
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
const editorialCandidateSchema = z.object({
  action_url: z.url(),
  city: z.string().nullable(),
  description: z.string().min(10).max(500),
  geo_specificity: z.enum(["local", "regional", "statewide", "national"]),
  issue_areas: z.array(z.string()).min(1).max(8),
  name: z.string().min(3).max(160),
  region: z.string().nullable(),
  source_context: z.string().min(10).max(500),
  source_url: z.url(),
  sources_checked: z.literal(true),
  state: z.string().length(2),
});

export type EditorialCandidateInput = z.infer<typeof editorialCandidateSchema>;

interface EditorialCandidateReceipt {
  entity_id: string;
  review_item_id: string;
  status: "pending";
}

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

export const stageEditorialCandidate = createServerFn({ method: "POST" })
  .validator(editorialCandidateSchema)
  .handler(async ({ data }) => {
    return await requestAtlasApi<EditorialCandidateReceipt>("/review-queue/editorial-candidates", {
      body: JSON.stringify(data),
      method: "POST",
    });
  });

function toReview(item: ReviewQueueItemResponse): DiscoveryReview {
  return {
    changes: Object.entries(item.proposed_changes ?? {}).map(([field, values]) => ({
      after: displayValue(values.after),
      before: displayValue(values.before),
      field,
    })),
    entityCity: item.entity_city ?? null,
    entityDescription: item.entity_description ?? null,
    entityName: item.entity_name || "Unnamed profile",
    entitySlug: item.entity_slug ?? null,
    entityState: item.entity_state ?? null,
    entityType: item.entity_type ?? null,
    entityWebsite: item.entity_website ?? null,
    holdReason: item.hold_reason,
    id: item.id,
    issueAreas: item.entity_issue_areas ?? [],
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
