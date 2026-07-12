/**
 * React Query helpers for the authenticated "Your Research" home summary.
 */
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { loadResearchSummary, type ResearchSummary } from "../server/research-summary";

/** Stable React Query key for the research-home summary. */
export const RESEARCH_SUMMARY_KEY = ["workspace", "research-summary"] as const;

/**
 * Shared query options for the research-home summary.
 *
 * Route loaders seed this query before render so the page paints from the same
 * cache entry it later revalidates on the client.
 *
 * @returns TanStack Query options for the research-home summary.
 */
export function researchSummaryQueryOptions() {
  return queryOptions<ResearchSummary>({
    queryKey: RESEARCH_SUMMARY_KEY,
    queryFn: () => loadResearchSummary(),
  });
}

/**
 * Fetch and cache the research-home summary.
 *
 * @returns The React Query result wrapping the {@link ResearchSummary}.
 */
export function useResearchSummary() {
  return useSuspenseQuery(researchSummaryQueryOptions());
}
