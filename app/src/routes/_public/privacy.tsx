import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/platform/pages/privacy-page";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/privacy")({
  head: () =>
    buildPageHead({
      title: "Privacy | Atlas",
      description: "How Atlas handles account, billing, usage, and public-source civic data.",
      path: "/privacy",
    }),
  component: PrivacyPage,
});
