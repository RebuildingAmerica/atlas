import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

export interface CorrectionReport {
  createdAt: string;
  entitySlug: string | null;
  entityType: string | null;
  id: string;
  note: string | null;
  reason: string;
  sourceUrl: string | null;
  targetId: string;
  targetName: string;
  targetType: "entity" | "source";
}

export interface CorrectionInboxPageData {
  items: CorrectionReport[];
  total: number;
}

interface ApiCorrectionReport {
  created_at: string;
  entity_slug: string | null;
  entity_type: string | null;
  id: string;
  note: string | null;
  reason: string;
  source_url: string | null;
  target_id: string;
  target_name: string;
  target_type: "entity" | "source";
}

interface ApiCorrectionInbox {
  items: ApiCorrectionReport[];
  total: number;
}

const pageSchema = z.object({ offset: z.number().int().nonnegative() });
const decisionSchema = z.object({
  decision: z.enum(["resolve", "dismiss"]),
  reportId: z.string().uuid(),
  targetType: z.enum(["entity", "source"]),
});

export const listCorrectionReports = createServerFn({ method: "POST" })
  .validator(pageSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<ApiCorrectionInbox>(
      `/correction-inbox?limit=25&offset=${data.offset}`,
    );
    return {
      items: response.items.map((item) => ({
        createdAt: item.created_at,
        entitySlug: item.entity_slug,
        entityType: item.entity_type,
        id: item.id,
        note: item.note,
        reason: item.reason,
        sourceUrl: item.source_url,
        targetId: item.target_id,
        targetName: item.target_name,
        targetType: item.target_type,
      })),
      total: response.total,
    } satisfies CorrectionInboxPageData;
  });

export const decideCorrectionReport = createServerFn({ method: "POST" })
  .validator(decisionSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<{ id: string; status: string }>(
      `/${data.targetType}-flags/${encodeURIComponent(data.reportId)}/${data.decision}`,
      { method: "POST" },
    );
    return { id: response.id, status: response.status };
  });
