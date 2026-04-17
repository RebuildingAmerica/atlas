import { z } from "zod";

/**
 * Parsed session shape Atlas expects back from Better Auth session reads.
 */
export const atlasSessionSchema = z.object({
  session: z
    .object({
      activeOrganizationId: z.string().nullable().optional(),
      id: z.string(),
    })
    .passthrough(),
  user: z
    .object({
      email: z.string(),
      emailVerified: z.boolean(),
      id: z.string(),
      name: z.string(),
    })
    .passthrough(),
});
