import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";
import { loadProfilesCatalog } from "@/domains/catalog/server/profiles/profile-loaders";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/profiles/people/")({
  loader: async () => {
    const catalog = await loadProfilesCatalog({ data: { scope: "people" } });
    return { catalog };
  },
  head: () =>
    buildPageHead({
      title: "People Profiles | Atlas",
      description:
        "Browse source-backed Atlas profiles for people rebuilding America by place, issue area, and public record.",
      path: "/profiles/people",
    }),
  component: PeopleProfilesIndexRoute,
});

function PeopleProfilesIndexRoute() {
  const { catalog } = Route.useLoaderData();
  return <ProfilesOverviewPage scope="people" initialCatalog={catalog} />;
}
