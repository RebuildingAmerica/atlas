/**
 * Server functions for profile overview/detail route data.
 */
import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { lockedEntryTypesForScope } from "@/domains/catalog/profile-browse";
import { api } from "@/lib/api";
import { AtlasApiError } from "@/lib/orval/fetcher";
import type { Entry, EntryListResponse } from "@/types";

const profileSlugSchema = z.object({
  type: z.enum(["people", "organizations"]),
  slug: z.string().min(1),
});

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

export const loadProfileConnections = createServerFn({ method: "GET" })
  .inputValidator(connectionsSchema)
  .handler(async ({ data }) => {
    return await api.entries.getConnections(data.entryId);
  });

const profilesOverviewSchema = z.object({
  scope: z.enum(["all", "people", "organizations"]),
});

/**
 * Load the marquee slice a profiles-overview page renders during SSR.
 *
 * Filters by the same `entry_types` set the page passes to `useEntries`, so
 * React Query treats the loader payload as `initialData` for the matching
 * query key instead of issuing a fresh fetch on hydration.
 */
export const loadProfilesCatalog = createServerFn({ method: "GET" })
  .inputValidator(profilesOverviewSchema)
  .handler(async ({ data }): Promise<EntryListResponse> => {
    return await api.entries.list({
      entry_types: lockedEntryTypesForScope(data.scope),
      limit: 18,
    });
  });

const slugOnlySchema = z.object({
  slug: z.string().min(1),
});

function isNotFoundError(error: unknown): boolean {
  return error instanceof AtlasApiError && error.status === 404;
}

/**
 * Resolve a slug to an entry whether it's a person or an organization.
 *
 * Issues both lookups concurrently so a high-latency miss against one type
 * doesn't serialize behind the other. The first non-404 result wins; if both
 * 404 we throw `notFound`, otherwise the first non-404 error surfaces.
 */
export const loadEntryBySlugAny = createServerFn({ method: "GET" })
  .inputValidator(slugOnlySchema)
  .handler(async ({ data }): Promise<Entry> => {
    const [people, orgs] = await Promise.allSettled([
      api.entries.getBySlug("people", data.slug),
      api.entries.getBySlug("organizations", data.slug),
    ]);

    if (people.status === "fulfilled") return people.value;
    if (orgs.status === "fulfilled") return orgs.value;

    if (isNotFoundError(people.reason) && isNotFoundError(orgs.reason)) {
      notFound({ throw: true });
      return undefined as never;
    }

    throw isNotFoundError(people.reason) ? orgs.reason : people.reason;
  });
