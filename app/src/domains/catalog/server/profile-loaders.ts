/**
 * Server functions for loading profile data during SSR.
 *
 * These run on the server during the route loader phase, fetching entry
 * data by slug so the profile page can be fully rendered before reaching
 * the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { api } from "@/lib/api";

const profileSlugSchema = z.object({
  type: z.enum(["people", "organizations"]),
  slug: z.string().min(1),
});

/** Load a full entry by its type-prefixed slug for SSR profile pages. */
export const loadProfileBySlug = createServerFn({ method: "GET" })
  .inputValidator(profileSlugSchema)
  .handler(async ({ data }) => {
    return await api.entries.getBySlug(data.type, data.slug);
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
