import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/platform/pages/privacy-page";

export const Route = createFileRoute("/_public/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy | Atlas" },
      {
        name: "description",
        content: "How Atlas handles account, billing, usage, and public-source civic data.",
      },
    ],
  }),
  component: PrivacyPage,
});
