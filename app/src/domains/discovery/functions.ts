import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "./server/api-client";
import type { DiscoveryRun, DiscoveryRunListResponse } from "@/types";

const discoveryPayloadSchema = z.object({
  issue_areas: z.array(z.string()).min(1),
  location_query: z.string().min(1),
  state: z.string().length(2),
});

export const listDiscoveryRuns = createServerFn({ method: "GET" }).handler(async () => {
  return await requestAtlasApi<DiscoveryRunListResponse>("/discovery-runs");
});

export const getDiscoveryRun = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await requestAtlasApi<DiscoveryRun>(`/discovery-runs/${data.id}`);
  });

export const startDiscoveryRun = createServerFn({ method: "POST" })
  .inputValidator(discoveryPayloadSchema)
  .handler(async ({ data }) => {
    return await requestAtlasApi<DiscoveryRun>("/discovery-runs", {
      body: JSON.stringify(data),
      method: "POST",
    });
  });
