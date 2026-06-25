/**
 * React Query hook for the authenticated "Your Research" home summary.
 *
 * The home route seeds this from its SSR loader payload via `initialData`, so
 * the page paints fully populated from the server HTML and only revalidates on
 * the client — server-default population with progressive enhancement.
 */
import { useQuery } from "@tanstack/react-query";
import { loadResearchSummary, type ResearchSummary } from "../server/research-summary";

/** Stable React Query key for the research-home summary. */
export const RESEARCH_SUMMARY_KEY = ["workspace", "research-summary"] as const;

/**
 * Fetch and cache the research-home summary, seeded from the loader payload.
 *
 * @param initialSummary - The SSR loader payload used as `initialData` so the
 *   first client render reuses the server-computed summary.
 * @returns The React Query result wrapping the {@link ResearchSummary}.
 */
export function useResearchSummary(initialSummary: ResearchSummary) {
  return useQuery<ResearchSummary>({
    queryKey: RESEARCH_SUMMARY_KEY,
    queryFn: () => loadResearchSummary(),
    initialData: initialSummary,
  });
}
