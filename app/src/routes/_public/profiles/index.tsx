import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";
import { loadProfilesCatalog } from "@/domains/catalog/server/profiles/profile-loaders";

export const Route = createFileRoute("/_public/profiles/")({
  loader: async () => {
    const catalog = await loadProfilesCatalog({ data: { scope: "all" } });
    return { catalog };
  },
  head: () => ({
    meta: [
      { title: "Profiles | Atlas" },
      {
        name: "description",
        content:
          "Browse Atlas profiles for people and organizations rebuilding America by issue, place, and public record.",
      },
    ],
  }),
  component: ProfilesRoute,
});

function ProfilesRoute() {
  const { catalog } = Route.useLoaderData();
  return <ProfilesOverviewPage initialCatalog={catalog} />;
}
