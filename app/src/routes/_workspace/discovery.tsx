import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DiscoveryPage } from "@/domains/discovery";
import { listDiscoveryRuns } from "@/domains/discovery/functions";
import { api } from "@/lib/api";
import type { DiscoveryResearchGoal } from "@/types";

interface DiscoverySearch {
  issue_areas?: string;
  location?: string;
  research_goal?: DiscoveryResearchGoal;
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
    if (search.state) {
      cleaned.state = search.state;
    }
    return cleaned;
  });

export const Route = createFileRoute("/_workspace/discovery")({
  validateSearch: discoverySearchSchema,
  loader: async () => {
    const [initialRuns, initialTaxonomy] = await Promise.all([
      listDiscoveryRuns(),
      api.taxonomy.list(),
    ]);
    return { initialRuns, initialTaxonomy };
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
  const { initialRuns, initialTaxonomy } = Route.useLoaderData();
  const initialRequest = Route.useSearch();
  return (
    <DiscoveryPage
      initialRequest={initialRequest}
      initialRuns={initialRuns}
      initialTaxonomy={initialTaxonomy}
    />
  );
}
