import type { Entry, EntryListResponse, EntrySearchFacets, EntryType } from "@/types";
import { expect } from "vitest";

const EMPTY_FACETS: EntrySearchFacets = {
  states: [],
  cities: [],
  regions: [],
  issue_areas: [],
  entity_types: [],
  source_types: [],
  source_patterns: [],
};

type SitemapEntryType = Extract<EntryType, "person" | "organization">;

interface EntryFixtureInput {
  type: SitemapEntryType;
  slug: string;
  updated_at?: string;
}

interface EntryListFixtureOptions {
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  total?: number;
}

export function buildSitemapEntry(input: EntryFixtureInput): Entry {
  return {
    id: `${input.type}-${input.slug || "missing-slug"}`,
    type: input.type,
    name: input.slug || "Missing slug",
    description: "Source-backed civic actor.",
    geo_specificity: "local",
    first_seen: "2024-04-01T12:34:56Z",
    last_seen: "2024-04-01T12:34:56Z",
    active: true,
    verified: false,
    claim: {
      status: "unclaimed",
      verification_level: "source-derived",
    },
    trust: {
      level: "unverified",
      independent_source_count: null,
      website_grounded: null,
      email_grounded: null,
    },
    issue_areas: [],
    source_types: [],
    source_count: 1,
    slug: input.slug,
    created_at: "2024-04-01T12:34:56Z",
    updated_at: input.updated_at ?? "2024-04-01T12:34:56Z",
  };
}

export function buildSitemapEntryListResponse(
  data: Entry[],
  options: EntryListFixtureOptions = {},
): EntryListResponse {
  return {
    data,
    pagination: {
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
      total: options.total ?? data.length,
      has_more: options.hasMore ?? false,
    },
    facets: EMPTY_FACETS,
  };
}

export async function readSitemapXml(): Promise<string> {
  const routeModule = await import("@/routes/sitemap[.]xml");
  const { asRouteStub } = await import("@/../tests/helpers/router-harness");
  const Route = asRouteStub(routeModule.Route);
  const handlers = Route.options.server?.handlers;
  if (!handlers?.GET) throw new Error("Expected GET handler");
  const response = (await handlers.GET({})) as Response;

  expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
  return response.text();
}
