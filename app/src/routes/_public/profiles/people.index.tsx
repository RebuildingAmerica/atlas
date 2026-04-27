import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";
import { loadProfilesCatalog } from "@/domains/catalog/server/profiles/profile-loaders";

export const Route = createFileRoute("/_public/profiles/people/")({
  loader: async () => {
    const catalog = await loadProfilesCatalog({ data: { scope: "people" } });
    return { catalog };
  },
  head: () => ({
    meta: [
      { title: "People Profiles | Atlas" },
      {
        name: "description",
        content:
          "Browse source-backed Atlas profiles for people rebuilding America by place, issue area, and public record.",
      },
    ],
  }),
  component: PeopleProfilesIndexRoute,
});

function PeopleProfilesIndexRoute() {
  const { catalog } = Route.useLoaderData();
  return <ProfilesOverviewPage scope="people" initialCatalog={catalog} />;
}
