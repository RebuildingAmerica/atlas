/**
 * Server functions for profile overview/detail route data.
 *
 * These live under a dedicated `server/profiles` namespace so the route
 * hierarchy and loader hierarchy stay aligned.
 */
import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { api } from "@/lib/api";
import { AtlasApiError } from "@/lib/orval/fetcher";

const profileSlugSchema = z.object({
  type: z.enum(["people", "organizations"]),
  slug: z.string().min(1),
});

/** Load a full entry by its type-prefixed slug for SSR profile pages. */
export const loadProfileBySlug = createServerFn({ method: "GET" })
  .inputValidator(profileSlugSchema)
  .handler(async ({ data }) => {
    try {
      return await api.entries.getBySlug(data.type, data.slug);
    } catch (error) {
      if (error instanceof AtlasApiError && error.status === 404) {
        notFound({ throw: true });
        return undefined as never;
      }

      throw error;
    }
  });

const connectionsSchema = z.object({
  entryId: z.string().min(1),
});

/** Load connections for a profile's sidebar during SSR. */
export const loadProfileConnections = createServerFn({ method: "GET" })
  .inputValidator(connectionsSchema)
  .handler(async ({ data }) => {
    return await api.entries.getConnections(data.entryId);
  });
