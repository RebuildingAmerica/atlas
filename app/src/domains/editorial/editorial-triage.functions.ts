import { createServerFn } from "@tanstack/react-start";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

/** How much is waiting in one editorial queue, and for how long. */
export interface TriageQueue {
  /** When the longest-waiting item arrived, or null when none can be shown. */
  oldestAt: string | null;
  waiting: number;
}

/** Every editorial queue an operator works through. */
export interface EditorialTriage {
  claims: TriageQueue;
  corrections: TriageQueue;
  discoveryReviews: TriageQueue;
}

interface OldestFirstItem {
  created_at: string;
}

/** The first page of a queue the API lists oldest first. */
interface OldestFirstPage {
  items: OldestFirstItem[];
  total: number;
}

function queueFrom(page: OldestFirstPage): TriageQueue {
  return { oldestAt: page.items[0]?.created_at ?? null, waiting: page.total };
}

/**
 * Reads each queue's size and its longest-waiting item. Every queue lists
 * oldest first, so a one-item page answers both.
 */
export const loadEditorialTriage = createServerFn({ method: "GET" }).handler(async () => {
  const [corrections, discoveryReviews, claims] = await Promise.all([
    requestAtlasApi<OldestFirstPage>("/correction-inbox?limit=1&offset=0"),
    requestAtlasApi<OldestFirstPage>("/review-queue?limit=1&offset=0"),
    requestAtlasApi<OldestFirstPage>("/profiles/claims/review?limit=1&offset=0"),
  ]);
  return {
    claims: queueFrom(claims),
    corrections: queueFrom(corrections),
    discoveryReviews: queueFrom(discoveryReviews),
  } satisfies EditorialTriage;
});
