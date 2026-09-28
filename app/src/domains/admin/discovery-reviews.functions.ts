import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import type {
  EntityCollectionResponse,
  EntityDetailResponse,
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
  sourceEvidence?: { context: string; url: string }[];
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
const entityIdSchema = z.object({ entityId: z.string().uuid() });
const editorialSearchSchema = z.object({ query: z.string().trim().min(2).max(100) });
const editorialProfileChangeSchema = entityIdSchema.extend({ candidate: editorialCandidateSchema });

export interface EditorialProfileMatch {
  city: string | null;
  id: string;
  name: string;
  state: string | null;
}

export interface EditorialProfileDraft {
  id: string;
  initial: Partial<EditorialCandidateInput>;
  name: string;
  officialSources: string[];
  profileUrl: string | null;
}

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

export const searchEditorialProfiles = createServerFn({ method: "GET" })
  .validator(editorialSearchSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<EntityCollectionResponse>(
      `/entities?query=${encodeURIComponent(data.query)}&entity_type=organization&limit=10`,
    );
    return (response.items ?? []).map((item) => ({
      city: item.address.city ?? null,
      id: item.id,
      name: item.name,
      state: item.address.state ?? null,
    })) satisfies EditorialProfileMatch[];
  });

export const loadEditorialProfile = createServerFn({ method: "GET" })
  .validator(entityIdSchema)
  .handler(async ({ data }) => {
    const profile = await requestAtlasApi<EntityDetailResponse>(
      `/entities/${encodeURIComponent(data.entityId)}`,
    );
    const officialSources = (profile.sources ?? [])
      .filter((source) => source.type === "org_website")
      .map((source) => source.url);
    const scope = z
      .enum(["local", "regional", "statewide", "national"])
      .safeParse(profile.address.geo_specificity).data;
    return {
      id: profile.id,
      initial: {
        action_url: profile.contact.website ?? "",
        city: profile.address.city ?? null,
        description: profile.description,
        geo_specificity: scope ?? (profile.address.city ? "local" : "statewide"),
        issue_areas: profile.issue_area_ids ?? [],
        name: profile.name,
        region: profile.address.region ?? null,
        source_context: "",
        source_url: officialSources[0] ?? "",
        state: profile.address.state ?? "",
      },
      name: profile.name,
      officialSources,
      profileUrl: profile.profile_url ?? null,
    } satisfies EditorialProfileDraft;
  });

export const stageEditorialProfileChange = createServerFn({ method: "POST" })
  .validator(editorialProfileChangeSchema)
  .handler(async ({ data }) => {
    return await requestAtlasApi<EditorialCandidateReceipt>(
      `/review-queue/editorial-profiles/${encodeURIComponent(data.entityId)}/changes`,
      { body: JSON.stringify(data.candidate), method: "POST" },
    );
  });

function toReview(
  item: ReviewQueueItemResponse & { source_evidence?: { context: string; url: string }[] },
): DiscoveryReview {
  return {
    changes: Object.entries(item.proposed_changes ?? {})
      .filter(([field]) => field !== "source_evidence")
      .map(([field, values]) => ({
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
    sourceEvidence: item.source_evidence ?? [],
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
