import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

/** One editorial decision, allowed or refused, as the audit log keeps it. */
export interface EditorialActivity {
  action: string;
  actor: string;
  allowed: boolean;
  id: string;
  method: string;
  occurredAt: string;
  reason: string | null;
  route: string;
  target: Record<string, string>;
}

export interface EditorialActivityPage {
  items: EditorialActivity[];
  /** Pass back to read the next, older page; null when this is the oldest. */
  nextBefore: string | null;
}

interface ApiAuditEntry {
  action: string;
  actor_email: string | null;
  actor_id: string;
  allowed: boolean;
  id: string;
  method: string;
  occurred_at: string;
  reason: string | null;
  route: string;
  target: Record<string, string>;
}

interface ApiAuditPage {
  items: ApiAuditEntry[];
  next_before: string | null;
}

const pageSchema = z.object({ before: z.string().min(1).nullable() });

export const listEditorialActivity = createServerFn({ method: "POST" })
  .validator(pageSchema)
  .handler(async ({ data }) => {
    const query = new URLSearchParams({ limit: "50" });
    if (data.before) query.set("before", data.before);
    const response = await requestAtlasApi<ApiAuditPage>(`/audit-log?${query.toString()}`);
    return {
      items: response.items.map((item) => ({
        action: item.action,
        // The local operator has no email; its id names it.
        actor: item.actor_email || item.actor_id,
        allowed: item.allowed,
        id: item.id,
        method: item.method,
        occurredAt: item.occurred_at,
        reason: item.reason,
        route: item.route,
        target: item.target,
      })),
      nextBefore: response.next_before,
    } satisfies EditorialActivityPage;
  });
