import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/platform/pages/privacy-page";

export const Route = createFileRoute("/_public/privacy")({
  component: PrivacyPage,
});
