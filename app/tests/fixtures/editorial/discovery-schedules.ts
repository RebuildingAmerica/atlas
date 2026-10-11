import type { IssueArea } from "@rebuildingamerica/atlas-api-client/taxonomy";
import type { DiscoverySchedule } from "@/domains/editorial/discovery-schedules.functions";

/** A schedule as the Atlas API returns it. */
export const API_SCHEDULE = {
  created_at: "2026-10-01T00:00:00Z",
  enabled: true,
  id: "schedule-1",
  issue_areas: ["housing_affordability"],
  last_run_at: "2026-10-08T06:00:00Z",
  last_run_id: "run-1",
  location_query: "Reno",
  search_depth: "standard",
  state: "NV",
  updated_at: "2026-10-08T06:00:00Z",
};

/** The same schedule as the editorial pages see it. */
export const RENO_SCHEDULE: DiscoverySchedule = {
  enabled: true,
  id: "schedule-1",
  issueAreas: ["housing_affordability"],
  lastRunAt: "2026-10-08T06:00:00Z",
  lastRunId: "run-1",
  locationQuery: "Reno",
  searchDepth: "standard",
  state: "NV",
};

/** A paused deep-search target that has never run. */
export const PAUSED_SCHEDULE: DiscoverySchedule = {
  enabled: false,
  id: "schedule-2",
  issueAreas: ["public_transit", "retired_issue"],
  lastRunAt: null,
  lastRunId: null,
  locationQuery: "Las Vegas",
  searchDepth: "deep",
  state: "NV",
};

export const SCHEDULE_ISSUE_AREAS: IssueArea[] = [
  { description: "", name: "Housing affordability", slug: "housing_affordability" },
  { description: "", name: "Public transit", slug: "public_transit" },
];
