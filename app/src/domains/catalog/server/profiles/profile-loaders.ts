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
import type { Entry, EntryListResponse, TaxonomyResponse } from "@/types";

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

/** Load the issue-area taxonomy for SSR consumers. */
export const loadTaxonomy = createServerFn({ method: "GET" }).handler(
  async (): Promise<TaxonomyResponse> => {
    return await api.taxonomy.list();
  },
);

const orgIdSchema = z.object({
  orgId: z.string().min(1),
});

/** Load an affiliated organization entry for a person profile during SSR. */
export const loadAffiliatedOrg = createServerFn({ method: "GET" })
  .inputValidator(orgIdSchema)
  .handler(async ({ data }): Promise<Entry | null> => {
    try {
      return await api.entries.get(data.orgId);
    } catch (error) {
      if (error instanceof AtlasApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  });

/** Load people affiliated with an organization during SSR. */
export const loadAffiliatedPeople = createServerFn({ method: "GET" })
  .inputValidator(orgIdSchema)
  .handler(async ({ data }): Promise<EntryListResponse> => {
    return await api.entries.list({
      entry_types: ["person"],
      limit: 50,
      affiliated_org_id: data.orgId,
    });
  });

const profilesOverviewSchema = z.object({
  scope: z.enum(["all", "people", "organizations"]),
});

/**
 * Load the hero/marquee slice a profiles-overview page renders during SSR.
 *
 * Intentionally narrow: only the catalog slice is fetched here so a slow
 * secondary shelf (people / organizations / issue landscape) cannot delay
 * first paint. Secondary shelves still hydrate client-side via React Query.
 */
export const loadProfilesCatalog = createServerFn({ method: "GET" })
  .inputValidator(profilesOverviewSchema)
  .handler(async ({ data }): Promise<EntryListResponse> => {
    const lockedTypes =
      data.scope === "people"
        ? (["person"] as const)
        : data.scope === "organizations"
          ? (["organization"] as const)
          : undefined;

    return await api.entries.list({
      entry_types: lockedTypes ? [...lockedTypes] : undefined,
      limit: 18,
    });
  });

const slugOnlySchema = z.object({
  slug: z.string().min(1),
});

/**
 * Resolve a slug to an entry whether it's a person or an organization.
 *
 * Tries the people slug-resolver first; on 404 falls back to organizations.
 * Used by the public `/claim/$slug` flow where the visitor only has the slug.
 */
export const loadEntryBySlugAny = createServerFn({ method: "GET" })
  .inputValidator(slugOnlySchema)
  .handler(async ({ data }): Promise<Entry> => {
    try {
      return await api.entries.getBySlug("people", data.slug);
    } catch (error) {
      if (!(error instanceof AtlasApiError && error.status === 404)) {
        throw error;
      }
    }
    try {
      return await api.entries.getBySlug("organizations", data.slug);
    } catch (error) {
      if (error instanceof AtlasApiError && error.status === 404) {
        notFound({ throw: true });
        return undefined as never;
      }
      throw error;
    }
  });
