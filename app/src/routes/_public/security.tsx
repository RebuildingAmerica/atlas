import { createFileRoute } from "@tanstack/react-router";
import { SecurityPage } from "@/platform/pages/security-page";

export const Route = createFileRoute("/_public/security")({
  head: () => ({
    meta: [
      { title: "Security | Atlas" },
      {
        name: "description",
        content:
          "Atlas security practices for account access, infrastructure, and responsible disclosure.",
      },
    ],
  }),
  component: SecurityPage,
});
