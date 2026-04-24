import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";

export const Route = createFileRoute("/_public/profiles/people/")({
  ssr: false,
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
  return <ProfilesOverviewPage scope="people" />;
}
