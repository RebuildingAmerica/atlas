import { createFileRoute } from "@tanstack/react-router";
import { TermsPage } from "@/platform/pages/terms-page";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/terms")({
  head: () =>
    buildPageHead({
      title: "Terms | Atlas",
      description:
        "Terms for using Atlas public profiles, workspaces, subscriptions, and source-linked data.",
      path: "/terms",
    }),
  component: TermsPage,
});
