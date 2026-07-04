import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/platform/pages/home-page";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/")({
  head: () =>
    buildPageHead({
      title: "Atlas | Source-Linked Local Civic Intelligence",
      description:
        "Find source-linked local civic intelligence by person, organization, issue, and place.",
      path: "",
    }),
  component: HomePage,
});
