import { createFileRoute } from "@tanstack/react-router";
import { TermsPage } from "@/platform/pages/terms-page";

export const Route = createFileRoute("/_public/terms")({
  head: () => ({
    meta: [
      { title: "Terms | Atlas" },
      {
        name: "description",
        content:
          "Terms for using Atlas public profiles, workspaces, subscriptions, and source-linked data.",
      },
    ],
  }),
  component: TermsPage,
});
