import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "./server/api-client";
import type { DiscoveryJobQueueResponse, DiscoveryRun, DiscoveryRunListResponse } from "@/types";

const discoveryPayloadSchema = z.object({
  issue_areas: z.array(z.string()).min(1),
  location_query: z.string().min(1),
  research_goal: z.enum(["landscape_scan", "interview_leads", "partner_scan", "ecosystem_map"]),
  state: z.string().length(2),
});

const discoveryJobQueueInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
});

export const listDiscoveryRuns = createServerFn({ method: "GET" }).handler(async () => {
  return await requestAtlasApi<DiscoveryRunListResponse>("/discovery-runs");
});

export const listDiscoveryJobQueue = createServerFn({ method: "GET" })
  .validator(discoveryJobQueueInputSchema)
  .handler(async ({ data }) => {
    return await requestAtlasApi<DiscoveryJobQueueResponse>(
      `/discovery-runs/jobs?limit=${data.limit}`,
    );
  });

export const getDiscoveryRun = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await requestAtlasApi<DiscoveryRun>(`/discovery-runs/${data.id}`);
  });

export const startDiscoveryRun = createServerFn({ method: "POST" })
  .validator(discoveryPayloadSchema)
  .handler(async ({ data }) => {
    return await requestAtlasApi<DiscoveryRun>("/discovery-runs", {
      body: JSON.stringify(data),
      method: "POST",
    });
  });
