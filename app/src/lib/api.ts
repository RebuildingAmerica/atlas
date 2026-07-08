import {
  listIssueAreas,
  listPublicDirectories as listPublicDirectoryRecords,
  type PublicDirectoryIndexResponse,
} from "@/lib/generated/atlas";
import {
  mapPoints,
  buildEntityListParams,
  buildMapPointParams,
  getEntry,
  getEntryBySlug,
  getConnections,
  listEntries,
} from "@/lib/api-entry";
import { getPlacePage, listPlaceActors, listPlaceLatest } from "@/lib/api-place";
import type { DiscoveryRun, DiscoveryRunListResponse, TaxonomyResponse } from "@/types";

const TAXONOMY_PAGE_SIZE = 100;

async function listTaxonomy(): Promise<TaxonomyResponse> {
  const issues: NonNullable<Awaited<ReturnType<typeof listIssueAreas>>["items"]> = [];
  let cursor: string | undefined;

  do {
    const response = await listIssueAreas({ cursor, limit: TAXONOMY_PAGE_SIZE });
    issues.push(...(response.items ?? []));
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return issues.reduce<TaxonomyResponse>((acc, issue) => {
    const bucket = acc[issue.domain] ?? [];
    bucket.push({
      slug: issue.slug,
      name: issue.name,
      description: issue.description,
    });
    acc[issue.domain] = bucket;
    return acc;
  }, {});
}

async function listPublicDirectories(): Promise<PublicDirectoryIndexResponse> {
  return listPublicDirectoryRecords();
}

export const api = {
  entries: {
    list: listEntries,
    get: getEntry,
    getBySlug: getEntryBySlug,
    getConnections,
    mapPoints,
  },
  discovery: {
    list(): Promise<DiscoveryRunListResponse> {
      return Promise.resolve({ items: [], total: 0 });
    },
    get(_runId: string): Promise<DiscoveryRun> {
      return Promise.reject(new Error("Use the authenticated discovery server functions instead."));
    },
    start(_payload: unknown): Promise<DiscoveryRun> {
      return Promise.reject(new Error("Use the authenticated discovery server functions instead."));
    },
  },
  taxonomy: {
    list: listTaxonomy,
  },
  publicDirectories: {
    list: listPublicDirectories,
  },
  places: {
    getPage: getPlacePage,
    listActors: listPlaceActors,
    listLatest: listPlaceLatest,
  },
};

export { buildEntityListParams, buildMapPointParams };
