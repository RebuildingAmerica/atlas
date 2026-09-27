import { createFileRoute } from "@tanstack/react-router";
import { BrowsePage } from "@/domains/catalog/components/browse/browse-page";
import { buildProfileDirectoryFilters } from "@/domains/catalog/profile-browse";
import { loadOrDegrade } from "@/platform/routes/load-or-degrade";
import { buildPageHead } from "@/platform/seo";
import { api, type EntryListResponse } from "@rebuildingamerica/atlas-api-client";
import {
  browseSearchSchema,
  type BrowseRouteSearch,
} from "@rebuildingamerica/atlas-catalog/search-state";

export const Route = createFileRoute("/_public/profiles/organizations/")({
  validateSearch: browseSearchSchema,
  loaderDeps: ({ search }): { search: BrowseRouteSearch } => ({ search }),
  loader: async ({ deps }): Promise<{ initialEntries: EntryListResponse | undefined }> => ({
    initialEntries: await loadOrDegrade(() =>
      api.entries.list(buildProfileDirectoryFilters(deps.search, "organization")),
    ),
  }),
  head: () =>
    buildPageHead({
      title: "Organization Profiles | Atlas",
      description:
        "Find organizations by name, place, and issue, with linked sources and contact details where available.",
      path: "/profiles/organizations",
    }),
  component: OrganizationProfilesIndexRoute,
});

function OrganizationProfilesIndexRoute() {
  const search = Route.useSearch();
  const { initialEntries } = Route.useLoaderData();
  return (
    <BrowsePage
      initialEntries={initialEntries}
      search={search}
      page={{
        description: "Find organizations by name, issue, or place.",
        eyebrow: "Directory",
        title: "Organizations",
        lockedEntryTypes: ["organization"],
        resultLabelPlural: "organizations",
        resultsHeading: "Organizations",
        searchLabel: "Search organizations by name, issue, or place",
        searchPlaceholder: "Search organizations by name, issue, or place",
      }}
    />
  );
}
