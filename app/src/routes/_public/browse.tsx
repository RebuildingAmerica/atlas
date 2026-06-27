import { createFileRoute } from "@tanstack/react-router";
import { BrowsePage, browseSearchSchema } from "@/domains/catalog";
import { buildBrowseSearch, type BrowseRouteSearch } from "@/domains/catalog/search-state";
import { api } from "@/lib/api";
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
  head: () => ({
    meta: [
      { title: "Browse | Atlas" },
      {
        name: "description",
        content:
          "Browse source-linked civic actors by place, issue, source type, and public evidence.",
      },
    ],
  }),
  component: BrowseRoute,
});

function BrowseRoute() {
  const search = Route.useSearch();
  const { initialEntries } = Route.useLoaderData();

  return <BrowsePage initialEntries={initialEntries} search={search} />;
}
