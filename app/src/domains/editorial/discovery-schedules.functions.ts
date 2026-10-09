import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi, requestAtlasApiWithoutBody } from "@/domains/discovery/server/api-client";

/** How hard the nightly run searches a target. */
export type ScheduleSearchDepth = "standard" | "deep";

/** One place and set of issues Atlas re-researches every night. */
export interface DiscoverySchedule {
  enabled: boolean;
  id: string;
  issueAreas: string[];
  lastRunAt: string | null;
  lastRunId: string | null;
  locationQuery: string;
  searchDepth: ScheduleSearchDepth;
  state: string;
}

interface ApiDiscoverySchedule {
  enabled: boolean;
  id: string;
  issue_areas: string[];
  last_run_at: string | null;
  last_run_id: string | null;
  location_query: string;
  search_depth: string;
  state: string;
}

interface ApiDiscoveryScheduleCollection {
  items: ApiDiscoverySchedule[];
  total: number;
}

const SEARCH_DEPTHS = ["standard", "deep"] as const;

const createScheduleSchema = z.object({
  issueAreas: z.array(z.string().min(1)).min(1),
  locationQuery: z.string().trim().min(1),
  searchDepth: z.enum(SEARCH_DEPTHS),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
});
const toggleScheduleSchema = z.object({ enabled: z.boolean(), scheduleId: z.string().min(1) });
const deleteScheduleSchema = z.object({ scheduleId: z.string().min(1) });

function toSchedule(item: ApiDiscoverySchedule): DiscoverySchedule {
  const depth = SEARCH_DEPTHS.find((value) => value === item.search_depth);
  if (!depth) {
    throw new Error(`The API returned an unknown search depth: ${item.search_depth}`);
  }
  return {
    enabled: item.enabled,
    id: item.id,
    issueAreas: item.issue_areas,
    lastRunAt: item.last_run_at,
    lastRunId: item.last_run_id,
    locationQuery: item.location_query,
    searchDepth: depth,
    state: item.state,
  };
}

function schedulePath(scheduleId: string): string {
  return `/discovery-schedules/${encodeURIComponent(scheduleId)}`;
}

export const listDiscoverySchedules = createServerFn({ method: "GET" }).handler(async () => {
  const response = await requestAtlasApi<ApiDiscoveryScheduleCollection>(
    "/discovery-schedules?limit=500",
  );
  return response.items.map(toSchedule);
});

export const createDiscoverySchedule = createServerFn({ method: "POST" })
  .validator(createScheduleSchema)
  .handler(async ({ data }) => {
    const created = await requestAtlasApi<ApiDiscoverySchedule>("/discovery-schedules", {
      body: JSON.stringify({
        issue_areas: data.issueAreas,
        location_query: data.locationQuery,
        search_depth: data.searchDepth,
        state: data.state,
      }),
      method: "POST",
    });
    return toSchedule(created);
  });

export const setDiscoveryScheduleEnabled = createServerFn({ method: "POST" })
  .validator(toggleScheduleSchema)
  .handler(async ({ data }) => {
    const updated = await requestAtlasApi<ApiDiscoverySchedule>(schedulePath(data.scheduleId), {
      body: JSON.stringify({ enabled: data.enabled }),
      method: "PATCH",
    });
    return toSchedule(updated);
  });

export const deleteDiscoverySchedule = createServerFn({ method: "POST" })
  .validator(deleteScheduleSchema)
  .handler(async ({ data }) => {
    await requestAtlasApiWithoutBody(schedulePath(data.scheduleId), { method: "DELETE" });
    return { id: data.scheduleId };
  });
