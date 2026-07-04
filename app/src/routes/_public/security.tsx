import { createFileRoute } from "@tanstack/react-router";
import { SecurityPage } from "@/platform/pages/security-page";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/security")({
  head: () =>
    buildPageHead({
      title: "Security | Atlas",
      description:
        "Atlas security practices for account access, infrastructure, and responsible disclosure.",
      path: "/security",
    }),
  component: SecurityPage,
});
