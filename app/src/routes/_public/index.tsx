import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/platform/pages/home-page";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "Atlas | Source-Linked Local Civic Intelligence" },
      {
        name: "description",
        content:
          "Find source-linked local civic intelligence by person, organization, issue, and place.",
      },
    ],
  }),
  component: HomePage,
});
