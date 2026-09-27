import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

export interface CorrectionReport {
  createdAt: string;
  entityId: string;
  entityName: string;
  entitySlug: string | null;
  entityType: string;
  id: string;
  note: string | null;
  reason: string;
}

export interface CorrectionInboxPageData {
  items: CorrectionReport[];
  total: number;
}

interface ApiCorrectionReport {
  created_at: string;
  entity_id: string;
  entity_name: string;
  entity_slug: string | null;
  entity_type: string;
  id: string;
  note: string | null;
  reason: string;
}

interface ApiCorrectionInbox {
  items: ApiCorrectionReport[];
  total: number;
}

const pageSchema = z.object({ offset: z.number().int().nonnegative() });
const decisionSchema = z.object({
  decision: z.enum(["resolve", "dismiss"]),
  reportId: z.string().uuid(),
});

export const listCorrectionReports = createServerFn({ method: "POST" })
  .validator(pageSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<ApiCorrectionInbox>(
      `/entity-flags/inbox?limit=25&offset=${data.offset}`,
    );
    return {
      items: response.items.map((item) => ({
        createdAt: item.created_at,
        entityId: item.entity_id,
        entityName: item.entity_name,
        entitySlug: item.entity_slug,
        entityType: item.entity_type,
        id: item.id,
        note: item.note,
        reason: item.reason,
      })),
      total: response.total,
    } satisfies CorrectionInboxPageData;
  });

export const decideCorrectionReport = createServerFn({ method: "POST" })
  .validator(decisionSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<{ id: string; status: string }>(
      `/entity-flags/${encodeURIComponent(data.reportId)}/${data.decision}`,
      { method: "POST" },
    );
    return { id: response.id, status: response.status };
  });
