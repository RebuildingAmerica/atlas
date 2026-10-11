import type { EditorialTriage } from "@/domains/editorial/editorial-triage.functions";

/** The moment the triage desk is read at in tests. */
export const TRIAGE_NOW = Date.parse("2026-10-09T12:00:00Z");

/** Queues with work waiting: corrections for 3 days, claims 2 hours, reviews 1 day. */
export function editorialTriage(overrides: Partial<EditorialTriage> = {}): EditorialTriage {
  return {
    claims: { oldestAt: "2026-10-09T10:00:00Z", waiting: 1 },
    corrections: { oldestAt: "2026-10-06T09:00:00Z", waiting: 4 },
    discoveryReviews: { oldestAt: "2026-10-08T11:30:00Z", waiting: 2 },
    ...overrides,
  };
}

/** Every queue empty. */
export function clearTriage(): EditorialTriage {
  return {
    claims: { oldestAt: null, waiting: 0 },
    corrections: { oldestAt: null, waiting: 0 },
    discoveryReviews: { oldestAt: null, waiting: 0 },
  };
}
