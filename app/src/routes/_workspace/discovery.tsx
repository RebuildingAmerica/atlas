import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { taxonomyQueryOptions } from "@/domains/catalog/hooks/use-taxonomy";
import { DiscoveryPage } from "@/domains/discovery";
import { discoveryRunsQueryOptions } from "@/domains/discovery/hooks/use-discovery";
import type { DiscoveryResearchGoal } from "@rebuildingamerica/atlas-api-client";

interface DiscoverySearch {
  issue_areas?: string;
  location?: string;
  research_goal?: DiscoveryResearchGoal;
  run?: string;
  state?: string;
}

export const discoverySearchSchema = z
  .object({
    issue_areas: z.string().optional().catch(undefined),
    location: z.string().optional().catch(undefined),
    research_goal: z
      .enum(["landscape_scan", "interview_leads", "partner_scan", "ecosystem_map"])
      .optional()
      .catch(undefined),
    run: z.string().optional().catch(undefined),
    state: z.string().optional().catch(undefined),
  })
  .transform((search): DiscoverySearch => {
    const cleaned: DiscoverySearch = {};
    if (search.issue_areas) {
      cleaned.issue_areas = search.issue_areas;
    }
    if (search.location) {
      cleaned.location = search.location;
    }
    if (search.research_goal) {
      cleaned.research_goal = search.research_goal;
    }
    if (search.run) {
      cleaned.run = search.run;
    }
    if (search.state) {
      cleaned.state = search.state;
    }
    return cleaned;
  });

export const Route = createFileRoute("/_workspace/discovery")({
  validateSearch: discoverySearchSchema,
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(discoveryRunsQueryOptions()),
      context.queryClient.ensureQueryData(taxonomyQueryOptions()),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Research | Atlas" },
      {
        name: "description",
        content: "Start source-linked local civic research and export reusable briefs.",
      },
    ],
  }),
  component: DiscoveryRoute,
});

function DiscoveryRoute() {
  const search = Route.useSearch();
  const { run, ...initialRequest } = search;
  return <DiscoveryPage initialRequest={initialRequest} selectedRunId={run} />;
}
