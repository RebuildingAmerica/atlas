import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";

export const Route = createFileRoute("/_public/profiles/")({
  ssr: false,
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
  return <ProfilesOverviewPage />;
}
