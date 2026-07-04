import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";
import { loadProfilesCatalog } from "@/domains/catalog/server/profiles/profile-loaders";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/profiles/")({
  loader: async () => {
    const catalog = await loadProfilesCatalog({ data: { scope: "all" } });
    return { catalog };
  },
  head: () =>
    buildPageHead({
      title: "Profiles | Atlas",
      description:
        "Explore source-linked Atlas profiles for people and organizations by issue, place, and public record.",
      path: "/profiles",
    }),
  component: ProfilesRoute,
});

function ProfilesRoute() {
  const { catalog } = Route.useLoaderData();
  return <ProfilesOverviewPage initialCatalog={catalog} />;
}
