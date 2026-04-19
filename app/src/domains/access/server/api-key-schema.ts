import { z } from "zod";

/**
 * Shared schema for Better Auth's resource-to-actions API-key permission map.
 */
export const apiKeyPermissionsSchema = z.record(z.string(), z.array(z.string()));

/**
 * Parsed shape for API-key records returned by Better Auth list operations.
 */
export const listedApiKeySchema = z
  .object({
    createdAt: z.union([z.string(), z.date()]),
    id: z.string(),
    name: z.string().nullable().optional(),
    permissions: apiKeyPermissionsSchema.nullish(),
    prefix: z.string().nullable().optional(),
    start: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * Better Auth lists API keys inside a collection envelope.
 */
export const listedApiKeysResponseSchema = z.object({
  apiKeys: z.array(listedApiKeySchema),
  total: z.number(),
});

/**
 * Minimal response shape Atlas cares about after creating an API key.
 */
export const createdApiKeySchema = z.object({
  key: z.string().optional(),
});

/**
 * Parsed shape for the private API-key verification response used by the
 * API.
 */
export const verifyApiKeyResultSchema = z
  .object({
    key: z
      .object({
        id: z.string(),
        metadata: z.record(z.string(), z.unknown()).nullish(),
        name: z.string().nullable().optional(),
        permissions: apiKeyPermissionsSchema.nullish(),
        referenceId: z.string(),
      })
      .nullable()
      .optional(),
    valid: z.boolean(),
  })
  .passthrough();
