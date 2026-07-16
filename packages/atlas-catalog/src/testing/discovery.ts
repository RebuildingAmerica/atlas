import type {
  DiscoveryResearchLead,
  DiscoveryResearchSummary,
  DiscoveryRun,
} from "@rebuildingamerica/atlas-api-client";

export function createCompletedResearchRunFixture(
  overrides: Partial<DiscoveryRun> = {},
): DiscoveryRun {
  return {
    id: "run_1",
    location_query: "Kansas City",
    research_goal: "interview_leads",
    started_at: "2026-04-20T10:00:00.000Z",
    completed_at: "2026-04-20T10:05:00.000Z",
    state: "MO",
    status: "completed",
    issue_areas: ["housing_affordability"],
    queries_generated: 2,
    sources_fetched: 5,
    sources_processed: 5,
    entries_extracted: 10,
    entries_after_dedup: 8,
    entries_confirmed: 3,
    research_summary: {
      brief: "Three source-backed tenant leads in Kansas City.",
      ranked_leads: [
        {
          entry_id: "entry-1",
          name: "KC Tenants",
          type: "organization",
          why_it_matters: "Named by city and community sources.",
          source_count: 2,
          confidence: "corroborated",
          latest_source_date: "2026-04-19",
        },
      ],
      key_sources: [
        {
          source_id: "source-1",
          title: "Tenant meeting agenda",
          url: "https://example.test/agenda",
          publication: "City Council",
          published_date: "2026-04-19",
          why_it_matters: "Names the lead and issue.",
        },
      ],
      gaps: [{ label: "County groups", detail: "No suburban source yet." }],
      reasoning_signals: ["Two independent sources point to the same actor."],
    },
    ...overrides,
  };
}

export function createDiscoveryResearchLeadFixture(
  overrides: Partial<DiscoveryResearchLead> = {},
): DiscoveryResearchLead {
  return {
    entry_id: "entry-1",
    latest_source_date: null,
    name: "KC Tenants",
    source_count: 1,
    type: "organization",
    why_it_matters: "Named by local sources.",
    ...overrides,
  };
}

export function createDiscoveryResearchSummaryFixture(
  overrides: Partial<DiscoveryResearchSummary> = {},
): DiscoveryResearchSummary {
  return {
    brief: "Source-backed leads.",
    gaps: [],
    key_sources: [],
    ranked_leads: [],
    reasoning_signals: [],
    ...overrides,
  };
}
