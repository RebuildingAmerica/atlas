import { createFileRoute } from "@tanstack/react-router";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import {
  browseSearchSchema,
  buildBrowseSearch,
  type BrowseRouteSearch,
} from "@/domains/catalog/search-state";
import { api } from "@/lib/api";
import { buildPageHead } from "@/platform/seo";
import type {
  EntryFilterParams,
  EntryListResponse,
  EntryType,
  SourcePattern,
  SourceType,
} from "@/types";

interface BrowseLoaderDeps {
  search: BrowseRouteSearch;
}

interface BrowseLoaderData {
  initialEntries: EntryListResponse;
}

function buildEntryFilters(search: BrowseRouteSearch): EntryFilterParams {
  const filters = buildBrowseSearch(search);

  return {
    cities: filters.cities,
    entry_types: filters.entry_types as EntryType[],
    issue_areas: filters.issue_areas,
    limit: 20,
    offset: filters.offset,
    query: filters.query,
    regions: filters.regions,
    source_patterns: filters.source_patterns as SourcePattern[],
    source_types: filters.source_types as SourceType[],
    states: filters.states,
  };
}

export const Route = createFileRoute("/_public/browse")({
  validateSearch: browseSearchSchema,
  loaderDeps: ({ search }): BrowseLoaderDeps => ({ search }),
  loader: async ({ deps }): Promise<BrowseLoaderData> => {
    const initialEntries = await api.entries.list(buildEntryFilters(deps.search));

    return { initialEntries };
  },
  head: () =>
    buildPageHead({
      title: "Browse | Atlas",
      description: "Find people and groups by place, issue, name, and source.",
      path: "/browse",
    }),
  component: BrowseRoute,
});

function BrowseRoute() {
  const search = Route.useSearch();
  const { initialEntries } = Route.useLoaderData();

  return <BrowsePage initialEntries={initialEntries} search={search} />;
}
