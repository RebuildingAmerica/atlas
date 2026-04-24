import { createFileRoute } from "@tanstack/react-router";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";

export const Route = createFileRoute("/_public/profiles/organizations/")({
  ssr: false,
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
  return <ProfilesOverviewPage scope="organizations" />;
}
