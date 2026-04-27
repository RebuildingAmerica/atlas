import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";
import { loadProfilesCatalog } from "@/domains/catalog/server/profiles/profile-loaders";

export const Route = createFileRoute("/_public/profiles/organizations/")({
  loader: async () => {
    const catalog = await loadProfilesCatalog({ data: { scope: "organizations" } });
    return { catalog };
  },
  head: () => ({
    meta: [
      { title: "Organization Profiles | Atlas" },
      {
        name: "description",
        content:
          "Browse source-backed Atlas profiles for organizations rebuilding America by place, issue area, and public coverage.",
      },
    ],
  }),
  component: OrganizationProfilesIndexRoute,
});

function OrganizationProfilesIndexRoute() {
  const { catalog } = Route.useLoaderData();
  return <ProfilesOverviewPage scope="organizations" initialCatalog={catalog} />;
}
